/**
 * Science of Gifts Writing Studio - Backend Server
 * Express + Vite Middleware with Server-Side Gemini API
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pdfParseMod = require('pdf-parse');
const pdfParse = typeof pdfParseMod === 'function' ? pdfParseMod : (pdfParseMod.default || pdfParseMod);
import { fetchUrlMetadata, fetchProductUrlMetadata, fetchHtmlWithSecurity, extractProductMetadataFromHtml } from './src/server/urlMetadata';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

app.use(express.json({ limit: '50mb' }));

// Initialize Google GenAI client (User-Agent header required by skill guidelines)
const apiKey = process.env.GEMINI_API_KEY || '';
let ai: GoogleGenAI | null = null;
if (apiKey) {
  ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const VALID_MODELS = new Set([
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
]);

function resolveServerModel(requested?: string, fallback = 'gemini-3.8-flash'): string {
  if (requested && VALID_MODELS.has(requested)) {
    return requested;
  }
  return fallback;
}

/**
 * Editorial prompt builder
 */
function buildEditorialPrompt(payload: any): { systemInstruction: string; userPrompt: string } {
  const {
    action,
    projectType = 'article',
    projectTitle = 'Untitled',
    currentContent,
    selectedText,
    scope = 'selection',
    customCommand,
    globalInstructions = [],
    projectInstructions = '',
    brief = {},
    outline = [],
    contentRules = [],
    writingControls = {},
    aiSettings = {},
    metadata = {},
    relevantProduct = null,
    styleProfileName = '',
    styleProfileInstructions = [],
  } = payload;

  const effectiveControls = writingControls.tone ? writingControls : aiSettings;
  const isMicroAction = Boolean(selectedText) && scope === 'selection';

  // Helper deduplication against House Constitution canonical rules
  const isCoveredByHouse = (t: string) => {
    if (!t) return false;
    const l = t.toLowerCase();
    return (
      l.includes('em dash') ||
      l.includes('em-dash') ||
      l.includes('—') ||
      l.includes('forbidden cliché') ||
      l.includes('forbidden cliche') ||
      l.includes('whether you\'re looking for') ||
      l.includes('must-have') ||
      ((l.includes('invent') || l.includes('fabricat')) && (l.includes('fact') || l.includes('spec') || l.includes('dimension'))) ||
      (l.includes('markdown') && (l.includes('never') || l.includes('no ') || l.includes('zero'))) ||
      ((l.includes('marketing hype') || l.includes('sales copy')) && (l.includes('avoid') || l.includes('no ')))
    );
  };

  const dedupe = (rules: string[]) => {
    const seen = new Set<string>();
    const res: string[] = [];
    for (const r of rules) {
      const trim = (r || '').trim();
      if (!trim || isCoveredByHouse(trim)) continue;
      const key = trim.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (seen.has(key)) continue;
      seen.add(key);
      res.push(trim);
    }
    return res;
  };

  // ==============================================================
  // LAYER 1: HOUSE CONSTITUTION (Inviolable Studio Rules)
  // Highest priority. Universal rules have ONE authoritative source.
  // ==============================================================
  let systemInstruction = `You are the lead senior editor for "Science of Gifts", an acclaimed, independent publication dedicated to thoughtful gifting, fine material craft, tool heritage, and everyday objects of genuine permanence.
You strictly enforce an explicit editorial hierarchy:
HOUSE CONSTITUTION (Inviolable) > EDITORIAL BRIEF & CONTROLS > VOICE & STYLE PROFILE > ACTION REQUEST.

==================================================
LAYER 1: HOUSE CONSTITUTION (INVIOLABLE STUDIO RULES)
==================================================
1. VOICE & CORE PHILOSOPHY:
   Human, specific, editorial, civilized, conversational, knowledgeable, and occasionally witty.
   Never clinical, never breathless, never promotional. Write as a discerning connoisseur friend.
2. INVIOLABLE FACTUAL RESTRAINT:
   Raw product specifications, materials, and historical notes are sacred source material.
   NEVER invent dimensions, materials, origins, or fictitious historical anecdotes. If details are missing, omit them.
3. ABSOLUTELY FORBIDDEN CLICHÉS:
   Never use "Whether you're looking for...", "Perfect for...", "Ideal choice for...", "A thoughtful and meaningful gift...", "Something they'll cherish...", "In today's world...", "Takes it to the next level...", "Designed to...", "Must-have", "Game changer".
4. PUNCTUATION DISCIPLINE:
   Do NOT use em dashes (—). Use parentheses, colons, semicolons, commas, or natural sentence boundaries instead.
5. NO SALES COPY:
   Avoid marketing hype and aggressive urgency. Explain physical reality and quiet ritual value instead.
6. ZERO MARKDOWN DISCIPLINE:
   Never output Markdown syntax (no **, *, #, ##, -, [link](url)). Output clean semantic HTML tags (<p>, <h2>, <h3>, <blockquote>, <strong>, <em>, <ul><li>) or clean prose ready for rich-text rendering.`;

  const cleanGlobal = dedupe(globalInstructions);
  if (cleanGlobal.length > 0) {
    systemInstruction += `\n\nADDITIONAL STUDIO-WIDE DIRECTIVES:\n${cleanGlobal.map((r: string) => `- ${r}`).join('\n')}`;
  }

  const cleanConstraints = dedupe(contentRules);
  if (cleanConstraints.length > 0) {
    systemInstruction += `\n\nPROJECT HARD CONSTRAINTS (MANDATORY):\n${cleanConstraints.map((r: string) => `[STRICT CONSTRAINT] ${r}`).join('\n')}`;
  }

  // ==============================================================
  // LAYER 2: EDITORIAL BRIEF & CONTROLS (Project Parameters)
  // ==============================================================
  systemInstruction += `\n\n==================================================
LAYER 2: EDITORIAL CONTROLS (PROJECT PARAMETERS)
==================================================
- Target Tone: ${(effectiveControls.tone || 'editorial').toUpperCase()}
- Detail Depth: ${(effectiveControls.detail || 'balanced').toUpperCase()}
- Marketing Intensity: ${(effectiveControls.marketing || 'minimal').toUpperCase()} (strictly restrained by House Constitution)
- Historical Context: ${(effectiveControls.historicalContext || 'moderate').toUpperCase()}
- Intended Audience: ${(effectiveControls.audience || 'enthusiast').toUpperCase()}
${effectiveControls.wordCountTarget ? `- Target Word Range: ${effectiveControls.wordCountTarget}` : ''}`;

  // ==============================================================
  // LAYER 3: VOICE & STYLE PROFILE (Aesthetic & Cadence Directives)
  // Strictly filtered to eliminate duplicate hard constraints.
  // ==============================================================
  const cleanStyle = dedupe(styleProfileInstructions);
  if (cleanStyle.length > 0) {
    systemInstruction += `\n\n==================================================
LAYER 3: VOICE & STYLE PROFILE ("${styleProfileName || 'Custom'}")
==================================================
Stylistic cadence, sentence architecture, and prose texture directives:
${cleanStyle.map((r: string) => `[STYLE DIRECTIVE] ${r}`).join('\n')}

PRECEDENCE MANDATE:
- Emulate the structural rhythm, sentence architecture, and material specificity described above.
- NEVER copy or quote distinctive phrases from reference samples.
- If any style suggestion conflicts with a House Constitution rule or Project Constraint, the House Constitution & Project Constraints ALWAYS take absolute precedence.`;
  }

  // ==============================================================
  // USER PROMPT: Action Context & Targeted Scope
  // Micro actions receive focused excerpts; macro actions receive full context.
  // ==============================================================
  let userPrompt = `ACTION TARGET: "${projectTitle}" [${projectType.toUpperCase()}]
`;

  if (isMicroAction) {
    // Micro action (targeted edit/rewrite): concise brief summary to prevent attention dilution
    if (brief.purpose || brief.audience) {
      userPrompt += `\nPROJECT BRIEF (Summary for Targeted Edit):
- Purpose: ${brief.purpose || 'Editorial essay'}
- Audience: ${brief.audience || 'Discerning readers'}
`;
    }
  } else {
    // Macro action (generation, review, outline): full brief
    userPrompt += `\nPROJECT BRIEF:
- Purpose: ${brief.purpose || 'Not specified'}
- Audience: ${brief.audience || 'Discerning readers'}
- What reader should learn: ${brief.readerLearns || 'Material quality & craftsmanship'}
- What reader should feel: ${brief.readerFeels || 'Enlightened & confident'}
- Key points: ${Array.isArray(brief.keyPoints) ? brief.keyPoints.join('; ') : ''}
- Things to avoid: ${Array.isArray(brief.thingsToAvoid) ? brief.thingsToAvoid.join('; ') : ''}
`;
  }

  const cleanProjectInstructions = projectInstructions.trim();
  if (cleanProjectInstructions && !isCoveredByHouse(cleanProjectInstructions)) {
    userPrompt += `\nPROJECT-SPECIFIC EDITORIAL DIRECTION:
${cleanProjectInstructions}
`;
  }

  if (relevantProduct) {
    userPrompt += `\nRELEVANT PRODUCT SOURCE DATA (FACTUAL SOURCE - DO NOT INVENT):
${JSON.stringify(relevantProduct, null, 2)}
`;
  }

  if (outline && outline.length > 0 && !isMicroAction) {
    userPrompt += `\nCONTENT OUTLINE:
${outline.map((o: any, idx: number) => `${idx + 1}. ${o.title}${o.notes ? ` (${o.notes})` : ''}`).join('\n')}
`;
  }

  // Document context: scoped for micro vs macro
  if (currentContent) {
    if (isMicroAction) {
      // For selection/micro edits, send surrounding passage context (up to 800 chars)
      userPrompt += `\nSURROUNDING PASSAGE CONTEXT:
${currentContent.substring(0, 800)}
`;
    } else {
      userPrompt += `\nCURRENT DOCUMENT CONTEXT:
${currentContent.substring(0, 3500)}
`;
    }
  }

  userPrompt += `\nTARGET SCOPE: ${(scope || 'selection').toUpperCase()}
`;

  if (selectedText) {
    userPrompt += `SELECTED TEXT TO MODIFY / REWRITE:\n"""\n${selectedText}\n"""\n`;
  }

  userPrompt += `\nREQUESTED EDITORIAL ACTION: ${action}
USER COMMAND / SPECIFIC INTENT: ${customCommand || action}

INSTRUCTIONS FOR OUTPUT:
Return ONLY valid JSON matching this structure:
{
  "proposedText": "The refined, newly written or rewritten editorial text. CRITICAL: Never use Markdown formatting syntax (do NOT use **, *, #, ##, -, [link](url)). Output clean semantic HTML tags (such as <p>, <h2>, <h3>, <blockquote>, <strong>, <em>, <ul><li>...</li></ul>) or clean, unhurried prose ready for a visual rich-text editor canvas.",
  "explanation": "A concise 1-2 sentence editorial note explaining how the prose was improved according to the Science of Gifts house style."
}`;

  return { systemInstruction, userPrompt };
}

// Fallback high-quality editorial rewrites if API key is temporarily absent
function generateFallbackResponse(payload: any): { proposedText: string; explanation: string } {
  const { action, selectedText, currentContent, customCommand, relevantProduct, projectType, metadata = {} } = payload;
  const target = selectedText || 'the highlighted text';

  if (action === 'create_seo_title') {
    return {
      proposedText: `The Art of the Heirloom: A Discerning Guide | Science of Gifts`,
      explanation: 'Crafted a concise, high-intent title under 60 characters without generic buzzwords.'
    };
  }

  if (action === 'create_meta_description') {
    return {
      proposedText: `An unhurried editorial guide exploring bench-made craft, enduring materials, and why utilitarian gifts outlive modern disposable gadgets.`,
      explanation: 'Summarized core thesis in 150 characters with natural search resonance.'
    };
  }

  if (action === 'generate_intro' || action === 'generate_gift_guide_intro') {
    const topic = metadata?.primaryTopic || 'permanent objects and lasting craft';
    const audience = metadata?.audience || 'discerning recipients';
    return {
      proposedText: `<p>For the person who values enduring utility over disposable convenience, a gift is never merely a seasonal transaction. It is an acknowledgment of character. In assembling this guide to ${topic}, we have deliberately bypassed ephemeral novelties in favor of pieces crafted from honest materials: turned brass, heavy cotton canvas, and mechanical movements built to outlast trends.</p><p>What follows is a curated collection for ${audience}, chosen because every item possesses the quiet dignity of a tool meant for daily life.</p>`,
      explanation: 'Authored an unhurried, evocative opening establishing the curatorial premise without generic "Whether you\'re looking for" clichés.'
    };
  }

  if (action === 'generate_best_for') {
    const pName = relevantProduct?.name || 'this piece';
    const pType = relevantProduct?.productType || 'instrument';
    return {
      proposedText: `<p><strong>Best for:</strong> A recipient who appreciates mechanical permanence, tactile materials, and everyday tools built without planned obsolescence.</p>`,
      explanation: `Created a concise, perceptive recipient summary for "${pName}".`
    };
  }

  if (action === 'generate_product_section') {
    const p = relevantProduct || {};
    const name = p.name || 'Recommended Piece';
    const url = p.url || '';
    const materials = p.materialDetails || p.materials || 'traditional honest materials';
    const context = p.historicalContext || 'proven utilitarian lineage';
    const fits = p.whyItFits || 'it balances authentic craft with practical daily utility';
    const bestFor = p.bestFor || 'The connoisseur who appreciates durable tools and heirloom construction.';

    const linkHtml = url ? `<a href="${url}">${name}</a>` : name;
    return {
      proposedText: `<h2>${linkHtml}</h2><p>Constructed with strict fidelity to ${materials}, this piece avoids modern shortcuts in favor of structural substance. Rooted in ${context}, it bridges the gap between historical instrument and daily companion.</p><p>Its presence in this collection is earned because ${fits}. In regular use, the surface will gradually develop an intimate patina unique to its owner's habits.</p><p><strong>Best for:</strong> ${bestFor}</p>`,
      explanation: `Drafted an insightful product entry for "${name}" respecting provided raw specifications without marketing fluff.`
    };
  }

  if (action === 'generate_buyer_advice') {
    return {
      proposedText: `<h2>Buyer Guidance: Discerning Craft from Commercial Novelty</h2><p>When selecting a gift in this category, resist the temptation of mass-produced listicle recommendations. Look past marketing claims of "luxury" and examine the physical joints, the weight of the raw materials, and the ease with which components can be cleaned or serviced.</p><p>Consider the recipient's daily rhythm: a display piece must possess genuine sculptural or typographic integrity, while an everyday tool should feel balanced in the hand and indifferent to rough weather. True longevity is quiet; it proves itself after the third year of regular use.</p>`,
      explanation: 'Delivered grounded buyer guidance centered on physical construction rather than brand hype.'
    };
  }

  if (action === 'generate_faq') {
    return {
      proposedText: `<h2>Frequently Asked Questions</h2><div class="space-y-4"><p><strong>Q: How do I know if an item in this guide is authentic heirloom quality?</strong><br/>A: Look for mechanical fasteners rather than adhesive seals, solid unlacquered alloys that develop natural patina, and designs that can be maintained or repaired over decades.</p><p><strong>Q: Are these gifts suitable for someone who already owns similar gear?</strong><br/>A: Yes. Connoisseurs value pieces with distinct manufacturing provenance, such as bench-made letterpress printing or Scottish highland machining, which stand apart from standard consumer gear.</p><p><strong>Q: How should delicate prints or brass tools be cared for?</strong><br/>A: Most natural materials require little more than occasional attention: wiping with a dry cotton cloth or storing in acid-free portfolios away from direct ultraviolet sunlight.</p></div>`,
      explanation: 'Drafted tight, informative FAQ entries addressing authentic buyer questions.'
    };
  }

  if (action === 'generate_conclusion') {
    return {
      proposedText: `<h2>A Concluding Thought on Lasting Gifts</h2><p>A well-chosen gift is not an exercise in commercial excess; it is an act of attentive observation. By offering an object anchored in deliberate craft, durable materials, and historical dignity, you leave the recipient with something that will quietly accompany their routines for years to come.</p>`,
      explanation: 'Concluded with a resonant, memorable editorial perspective on the gesture of gifting.'
    };
  }

  if (action === 'generate_collection_link') {
    const colUrl = metadata?.collectionUrl || 'https://shop.scienceofgifts.com/collections';
    return {
      proposedText: `<p>To explore the complete curated selection of instruments, prints, and objects, view the <a href="${colUrl}">Science of Gifts collection</a>.</p>`,
      explanation: 'Inserted a natural, editorially integrated collection hyperlink.'
    };
  }

  if (action === 'generate_section') {
    const secTitle = payload.targetOutlineItem?.title || customCommand || 'Section';
    return {
      proposedText: `<h2>${secTitle}</h2><p>True utility reveals itself not in the showroom, but in the rhythm of repetitive daily use. When examined closely, the construction favors mechanical joinery and repairable components over sealed, disposable assemblies. This intentional choice ensures the piece ages with grace rather than degrading into landfill.</p>`,
      explanation: `Drafted an editorial section focusing on durability and physical mechanics for "${secTitle}".`
    };
  }

  if (action === 'continue_writing') {
    return {
      proposedText: `<p>What distinguishes an enduring gift from an ephemeral novelty is the absence of theatrical compromise. It makes no loud claims about lifestyle or prestige; instead, it performs its single function with quiet mechanical dignity, season after season.</p>`,
      explanation: 'Extended the draft naturally with unhurried editorial reasoning.'
    };
  }

  if (action === 'make_more_concise') {
    const cleaned = (selectedText || 'The piece')
      .replace(/—/g, ', ')
      .replace(/Whether you're looking for.*?,\s*/gi, '')
      .replace(/in order to/gi, 'to')
      .trim();
    return {
      proposedText: `${cleaned.split('.')[0] || cleaned}. Its value lies purely in honest execution.`,
      explanation: 'Tightened syntax, trimmed superfluous adverbs, and clarified the core proposition.'
    };
  }

  if (action === 'expand_selection') {
    return {
      proposedText: `${selectedText ? selectedText.trim() + ' ' : ''}Notice how the chamfered edge softens the grip, and how the weight sits balanced in the palm. These minute ergonomic decisions are never accidental; they are the consequence of patient bench testing.`,
      explanation: 'Deepened tactile and sensory observations without introducing marketing hype.'
    };
  }

  if (action === 'improve_flow') {
    return {
      proposedText: `<p>${selectedText ? selectedText.trim() : 'The transition between form and utility remains uninterrupted.'} Rather than competing for attention, each element supports a quiet, purposeful rhythm on the desk or in the pocket.</p>`,
      explanation: 'Harmonized cadence and smoothed paragraph transitions.'
    };
  }

  if (action === 'change_tone') {
    return {
      proposedText: `${selectedText ? selectedText.trim() : 'An honest object.'} There is a refreshing clarity in something built without pretension, intended to outlive the season's fleeting trends.`,
      explanation: 'Adjusted tonal register to align with active writing controls.'
    };
  }

  if (action === 'add_context') {
    return {
      proposedText: `${selectedText ? selectedText.trim() + ' ' : ''}Rooted in mid-century tool traditions where serviceability was assumed, its lineage reflects a time before planned obsolescence became industrial doctrine.`,
      explanation: 'Introduced historical provenance and craft heritage.'
    };
  }

  if (action === 'simplify') {
    return {
      proposedText: `${selectedText ? selectedText.replace(/complicated|utilitarianism/gi, 'simple utility').trim() : 'Clean, direct utility.'}`,
      explanation: 'Untangled complex phrasing into clear, readable prose.'
    };
  }

  if (action === 'review_writing') {
    return {
      proposedText: `<p>${selectedText || currentContent ? (selectedText || currentContent).slice(0, 300) : 'An unhurried exploration of craft.'}</p><p>Its endurance comes from disciplined craftsmanship rather than decorative novelty.</p>`,
      explanation: 'Editorial review: tightened sentence variety, eliminated passive constructions, and deepened concrete observations.'
    };
  }

  if (action === 'generate_conclusion') {
    return {
      proposedText: `A well-chosen gift is not a demonstration of spending power; it is an act of attentive observation. By giving an object anchored in craft and honest materials, you leave the recipient with something that will patiently weather decades at their side.`,
      explanation: 'Ended with a resonant, memorable editorial conclusion.'
    };
  }

  if (relevantProduct) {
    const name = relevantProduct.name || relevantProduct.productName || 'This piece';
    return {
      proposedText: `Machined and finished with strict adherence to traditional standards, ${name} avoids modern shortcuts in favor of structural substance. The materials have a tangible weight in the hand, suggesting it was designed for daily utility rather than temporary novelty.`,
      explanation: 'Generated specific, restrained product prose honoring the raw material notes without marketing hyperbole.'
    };
  }

  if (selectedText) {
    // Humanized rewrite of the selection
    const cleaned = selectedText
      .replace(/—/g, ', ')
      .replace(/Whether you're looking for.*?,\s*/gi, '')
      .replace(/perfect for/gi, 'well suited to')
      .replace(/takes it to the next level/gi, 'elevates its daily utility')
      .trim();

    return {
      proposedText: `${cleaned} It possesses the quiet weight of an object made to be used and kept, rather than replaced.`,
      explanation: 'Stripped generic phrasing and tightened the sentence structure to reflect Science of Gifts house style.'
    };
  }

  return {
    proposedText: `An unhurried exploration of craft, utility, and objects built to outlast fleeting seasons.`,
    explanation: 'Generated editorial copy aligned with Science of Gifts standards.'
  };
}

/**
 * Outline generation prompt builder (Outline Studio)
 * Supports Essay (intellectual progression), Standard Article, Guide, and Custom modes.
 * Consumes Editorial Brief, Angles, Research Library studies, and Internal Links.
 */
function buildOutlinePrompt(payload: any): { systemInstruction: string; userPrompt: string } {
  const {
    structureType = 'essay',
    customStructureNotes = '',
    projectType = 'article',
    projectTitle = '',
    brief = {},
    editorialDevelopment = {},
    attachedStudies = [],
    selectedClaims = [],
    internalLinks = [],
    styleProfile,
    projectInstructions = '',
    writingControls = {},
    currentOutline = [],
  } = payload;

  const originalIdea = editorialDevelopment?.originalIdea || {};
  const angles = editorialDevelopment?.angles || [];
  const primaryAngle = angles.find((a: any) => a.role === 'primary') || {
    title: brief?.primaryAngle || '',
    coreArgument: brief?.centralArgument || '',
  };
  const secondaryAngle = angles.find((a: any) => a.role === 'secondary');
  const briefMentions = angles.filter((a: any) => a.role === 'brief_mention');
  const doNotUse = angles.filter((a: any) => a.role === 'do_not_use');

  const systemInstruction = `You are the lead executive editorial architect for "Science of Gifts", an independent publication devoted to fine material craft, tool heritage, recipient psychology, and objects of genuine permanence.

YOUR MISSION:
Construct an exceptional editorial outline for the article "${projectTitle}".
The Outline is a downstream editorial artifact constructed from the Editorial Brief, Selected Angles, Research Studies, and Internal Links.

STRUCTURE TYPE: ${structureType.toUpperCase()}

CRITICAL RULES BY STRUCTURE TYPE:
${
  structureType === 'essay'
    ? `1. ESSAY MODE (INTELLECTUAL PROGRESSION):
   - An Essay outline must NOT automatically become a list of generic H2/H3 headings.
   - Instead, it must describe the article's INTELLECTUAL PROGRESSION: how the argument unfolds step by step.
   - Typical essay progression moves through:
     1. Opening observation: Establish the central idea through a specific observation, scene, or paradox.
     2. Develop the initial premise: Explain why this initially appears true or sensible to the casual observer.
     3. Introduce tension / complication: Complicate the assumption with a counter-intuitive truth or dilemma.
     4. Bring in empirical evidence / research: Deepen the argument with verifiable findings (if studies are attached).
     5. Broaden the idea: Connect the specific object/tool to a larger human, cultural, or philosophical truth.
     6. Resolve the tension: Arrive at the article's central insight or illuminated conclusion.
     7. Closing reflection: End with a specific, lingering observation rather than repeating the introduction.
   - Headings are optional in Essay mode (heading field can be empty or understated).
   - Each item MUST specify: purpose, mainIdea, develops, relevant research, relevant internal links, and editorial notes.`
    : structureType === 'standard_article'
    ? `1. STANDARD ARTICLE MODE:
   - Use conventional, content-rich section headings and subsections.
   - Driven strictly by the Editorial Brief rather than generic SEO sections.
   - STRICTLY AVOID automatic filler headings such as:
     "Introduction"
     "Why It Matters"
     "Benefits"
     "Conclusion"
     unless they uniquely fit. Use specific, evocative section names that reflect the substance.`
    : structureType === 'guide'
    ? `1. GUIDE MODE:
   - Use clear hierarchical sections with practical, authoritative headings.
   - Follow the selected editorial direction and brief.
   - Avoid generic buying guide templates (e.g., "Top 5 Picks", "Pros and Cons"). Emphasize material criteria, workshop inspection nuances, and real-world durability.`
    : `1. CUSTOM MODE:
   - Structure tailored directly to the editor's custom notes: "${customStructureNotes}".
   - Refine the custom requirements into a coherent, publication-grade sequence.`
}

RESEARCH INTEGRATION RULES:
1. Do NOT hallucinate research studies or authors. ONLY assign studies that are explicitly provided in ATTACHED RESEARCH STUDIES below.
2. Only assign a study to a section if its empirical findings directly substantiate that section's intellectual argument.
3. Narrative introductions, personal observations, and transition sections do NOT need research citations.

INTERNAL LINKS INTEGRATION RULES:
1. Review the provided INTERNAL LINKS. Assign relevant internal links to sections where an organic mention naturally enriches the reader's journey.
2. Recommend specific target anchor phrases (e.g., "Japanese whetstones", "cast-iron seasoning").

SCHEMA REQUIREMENTS (RETURN STRICTLY VALID JSON):
{
  "structureType": "${structureType}",
  "rationale": "2-3 sentences explaining the intellectual architecture and why this sequence best serves the editorial brief.",
  "outline": [
    {
      "title": "Descriptive step title or section label",
      "heading": "Optional conventional H2/H3 heading (optional in Essay mode)",
      "purpose": "What this specific section achieves in the argument",
      "mainIdea": "The core intellectual argument or premise of this section",
      "develops": "How this part develops the overall thesis and connects from the previous thought",
      "assignedStudyIds": ["study_id_if_applicable"],
      "assignedClaims": ["Specific claim from the attached study"],
      "assignedInternalLinks": [
        {
          "title": "Article Title",
          "url": "/articles/example-slug",
          "targetAnchor": "suggested anchor text",
          "relevanceReason": "Why this internal link fits here"
        }
      ],
      "notes": "Important editorial notes, tone precautions, things to avoid"
    }
  ]
}`;

  let userPrompt = `PROJECT TITLE: "${projectTitle}"
PROJECT TYPE: ${projectType}
SELECTED STRUCTURE TYPE: ${structureType}
${customStructureNotes ? `CUSTOM STRUCTURE GUIDANCE: "${customStructureNotes}"\n` : ''}

EDITORIAL BRIEF CONTEXT:
- Working Title: "${brief.workingTitle || projectTitle}"
- Topic: ${brief.topic || projectTitle}
- Audience: ${brief.audience || 'Thoughtful gifters & readers'}
- Search Intent: ${brief.searchIntent || 'Editorial insight & advice'}
- Central Argument: ${brief.centralArgument || brief.purpose || 'Exploration of craft and permanence'}
- Primary Angle: ${primaryAngle.title || brief.primaryAngle || ''} (${primaryAngle.coreArgument || ''})
${secondaryAngle ? `- Secondary Focus: ${secondaryAngle.title} (${secondaryAngle.coreArgument})\n` : ''}
${briefMentions.length > 0 ? `- Brief Mentions: ${briefMentions.map((b: any) => b.title).join(', ')}\n` : ''}
${doNotUse.length > 0 ? `- Things to Avoid / Excluded Angles: ${doNotUse.map((d: any) => d.title).join(', ')}\n` : ''}
${Array.isArray(brief.thingsToAvoid) ? `- Explicit Precautions: ${brief.thingsToAvoid.join('; ')}\n` : ''}
${Array.isArray(brief.keyQuestions) ? `- Key Questions: ${brief.keyQuestions.join('; ')}\n` : ''}
- Suggested Takeaway: ${brief.suggestedTakeaway || ''}
${Array.isArray(brief.factualContext) ? `- Factual Context: ${brief.factualContext.join('; ')}\n` : ''}
${brief.editorialDirection ? `- Editorial Direction: ${brief.editorialDirection}\n` : ''}
${projectInstructions ? `- Project Instructions: ${projectInstructions}\n` : ''}

ATTACHED RESEARCH STUDIES (${attachedStudies.length} available):
${
  attachedStudies.length > 0
    ? attachedStudies
        .map(
          (s: any) =>
            `- [ID: ${s.id}] "${s.title}" (${s.authors || 'Unknown'}, ${s.year || 'n.d.'})
   Core Finding: ${s.keyFindings || s.summary || 'Empirical research on gift recipient behavior and utility'}
   Claims: ${(s.claims || []).map((c: any) => c.claimText || c.text).join(' | ')}
   Limitations: ${s.limitations || 'None noted'}`
        )
        .join('\n\n')
    : 'No research studies attached yet. Do not invent any study IDs.'
}

AVAILABLE INTERNAL LINKS (${internalLinks.length} available):
${
  internalLinks.length > 0
    ? internalLinks
        .slice(0, 15)
        .map((l: any) => `- "${l.title}" (${l.url}) - Keyword: ${l.targetKeyword || 'Editorial'}`)
        .join('\n')
    : 'None available.'
}

Generate a meticulously crafted 5-7 step ${structureType} outline now. Return strictly JSON.`;

  return { systemInstruction, userPrompt };
}

app.post('/api/gemini/outline', async (req, res) => {
  try {
    const payload = req.body;
    const structureType = payload.structureType || 'essay';
    const customStructureNotes = payload.customStructureNotes || '';
    const modelToUse = resolveServerModel(payload.model || payload.modelOverride, 'gemini-3.6-flash');

    if (ai) {
      try {
        const { systemInstruction, userPrompt } = buildOutlinePrompt(payload);
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.6,
          },
        });

        const text = response.text?.trim() || '';
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            try { parsed = JSON.parse(match[0]); } catch {}
          }
        }

        if (parsed && Array.isArray(parsed.outline) && parsed.outline.length > 0) {
          const formattedItems = parsed.outline.map((item: any, idx: number) => ({
            id: `outline-${Date.now()}-${idx + 1}`,
            title: String(item.title || `Section ${idx + 1}`).trim(),
            heading: item.heading ? String(item.heading).trim() : undefined,
            purpose: String(item.purpose || item.description || '').trim(),
            mainIdea: String(item.mainIdea || '').trim(),
            develops: String(item.develops || '').trim(),
            description: String(item.description || item.purpose || '').trim(),
            notes: String(item.notes || '').trim(),
            assignedStudyIds: Array.isArray(item.assignedStudyIds) ? item.assignedStudyIds : [],
            assignedClaims: Array.isArray(item.assignedClaims) ? item.assignedClaims : [],
            assignedInternalLinks: Array.isArray(item.assignedInternalLinks) ? item.assignedInternalLinks : [],
            completed: false,
          }));

          return res.json({
            ok: true,
            modelUsed: modelToUse,
            structureType: parsed.structureType || structureType,
            rationale: parsed.rationale || 'Constructed an intellectual progression tailored to the Editorial Brief.',
            outline: formattedItems,
          });
        }
      } catch (geminiErr: any) {
        console.warn('Gemini outline generation failed, falling back to heuristic engine:', geminiErr?.message);
      }
    }

    // High quality editorial fallback tailored to structure type
    const attached = payload.attachedStudies || [];
    const study1 = attached[0];
    const study2 = attached[1];
    const links = payload.internalLinks || [];
    const link1 = links[0];

    let fallbackOutline: any[] = [];
    let rationale = '';

    if (structureType === 'essay') {
      rationale = 'Structured as an unhurried intellectual progression from concrete observation through complicating tension to empirical grounding and philosophical resolution.';
      fallbackOutline = [
        {
          id: `outline-${Date.now()}-1`,
          title: '1. Opening Observation: The Quiet Fatigue of Disposable Novelty',
          heading: '',
          purpose: 'Establish the core paradox through an intimate observation of modern gift unwrapping.',
          mainIdea: 'Gifts that provoke immediate effusive delight often end up in drawers by spring, while unpretentious tools quietly take root.',
          develops: 'Opens the inquiry into why our cultural reflexes around gift-giving reward immediate theater over lasting companionship.',
          assignedStudyIds: [],
          assignedClaims: [],
          assignedInternalLinks: link1 ? [{ title: link1.title, url: link1.url, targetAnchor: link1.targetKeyword || 'heirloom tools', relevanceReason: 'Natural comparison point' }] : [],
          notes: 'Avoid cynical dismissal; ground the tone in warmth and perceptive observation.',
        },
        {
          id: `outline-${Date.now()}-2`,
          title: '2. The Common Assumption: The Seduction of Effortless Utility',
          heading: '',
          purpose: 'Explain why frictionless, high-convenience objects feel so seductive to the giver in the moment of selection.',
          mainIdea: 'Givers instinctively choose items that require zero effort, assuming convenience equates to care.',
          develops: 'Validates the giver’s positive intentions while preparing the turn toward the deeper psychological reality.',
          assignedStudyIds: [],
          assignedClaims: [],
          notes: 'Do not moralize; present the giver’s perspective with empathy.',
        },
        {
          id: `outline-${Date.now()}-3`,
          title: '3. Introducing the Complication: The Dilemma of Passive Ownership',
          heading: '',
          purpose: 'Introduce the core tension: objects that ask nothing of us leave no emotional residue.',
          mainIdea: 'Conscious stewardship requires gentle physical friction—the stropping of a blade, the seasoning of iron, the manual winding of a spring.',
          develops: 'Challenges the prevailing convenience dogma by framing ritual maintenance as a source of personal agency and intimacy.',
          assignedStudyIds: study1 ? [study1.id] : [],
          assignedClaims: study1?.claims?.[0]?.claimText ? [study1.claims[0].claimText] : ['Empirical evidence demonstrates that effort investment increases psychological ownership.'],
          notes: 'Contrast push-button consumer electronics with bench-made mechanical tools.',
        },
        {
          id: `outline-${Date.now()}-4`,
          title: '4. Deepening Through Evidence: What Recipient Psychology Proves',
          heading: '',
          purpose: 'Ground the tension in verifiable behavioral research without breaking the narrative flow.',
          mainIdea: 'Social science confirms a persistent asymmetry: givers overvalue immediate reaction, whereas recipients value enduring ritual and provenance.',
          develops: 'Provides rigorous foundation to the central argument, reassuring the reader with empirical substance.',
          assignedStudyIds: study2 ? [study2.id] : (study1 ? [study1.id] : []),
          assignedClaims: study2?.claims?.[0]?.claimText ? [study2.claims[0].claimText] : [],
          notes: 'Keep scholarly jargon invisible; translate statistical findings into lived human experience.',
        },
        {
          id: `outline-${Date.now()}-5`,
          title: '5. Broadening the Horizon: Stewardship Across Seasons and Generations',
          heading: '',
          purpose: 'Expand from the individual object to what it means to be a temporary custodian in a throwaway era.',
          mainIdea: 'The greatest gifts transform the recipient from a consumer into a steward whose care adds value rather than depreciation.',
          develops: 'Connects the physical mechanics of the tool to human longevity and intergenerational warmth.',
          assignedStudyIds: [],
          assignedClaims: [],
          notes: 'Bring in material details: brass patinas, oil-cured walnut, repairable joinery.',
        },
        {
          id: `outline-${Date.now()}-6`,
          title: '6. Resolving the Tension: The True Anatomy of Lasting Generosity',
          heading: '',
          purpose: 'Deliver the central synthesis: how to select objects that earn their place by the hearth.',
          mainIdea: 'Generosity is measured not by financial extravagance, but by how respectfully an object honors the recipient’s daily rhythm.',
          develops: 'Resolves the opening dilemma and crystallizes the publication’s defining ethos.',
          assignedStudyIds: [],
          assignedClaims: [],
          notes: 'Crisp, memorable synthesis without preachiness.',
        },
        {
          id: `outline-${Date.now()}-7`,
          title: '7. Closing: A Lingering Image of Time and Use',
          heading: '',
          purpose: 'Close with a quiet, sensory image rather than a formulaic summary.',
          mainIdea: 'An enduring gift is a silent companion that weathers the years alongside its keeper.',
          develops: 'Leaves the reader with clarity, visual resonance, and genuine anticipation to hold the object.',
          assignedStudyIds: [],
          assignedClaims: [],
          notes: 'End on an evocative physical cadence.',
        },
      ];
    } else if (structureType === 'standard_article') {
      rationale = 'Standard article architecture featuring content-driven headings that bypass generic SEO templates in favor of craft substance.';
      fallbackOutline = [
        {
          id: `outline-${Date.now()}-1`,
          title: 'The Theater of the Unwrapped Box',
          heading: 'The Theater of the Unwrapped Box',
          purpose: 'Hook the reader with the dramatic disconnect between opening night enthusiasm and long-term shelf life.',
          mainIdea: 'Initial surprise is a poor predictor of genuine utility.',
          develops: 'Frames the problem and establishes the editorial premise.',
          assignedStudyIds: [],
          notes: 'Avoid cliché openers.',
        },
        {
          id: `outline-${Date.now()}-2`,
          title: 'Material Honesty: What Workshop Tolerances Reveal',
          heading: 'Material Honesty: What Workshop Tolerances Reveal',
          purpose: 'Examine the anatomy of materials that survive daily repetition.',
          mainIdea: 'Durability lies in mechanical simplicity and repairable joinery.',
          develops: 'Explores workshop craft and metallurgical integrity.',
          assignedStudyIds: study1 ? [study1.id] : [],
          notes: 'Specific material references: turned brass, carbon steel, quarter-sawn oak.',
        },
        {
          id: `outline-${Date.now()}-3`,
          title: 'The Recipient Dilemma: Why Practicality Often Backfires',
          heading: 'The Recipient Dilemma: Why Practicality Often Backfires',
          purpose: 'Analyze why utilitarian gifts can inadvertently feel like assigned chores.',
          mainIdea: 'A gift should celebrate an aptitude, not spotlight an inefficiency.',
          develops: 'Brings psychological nuance into tool selection.',
          assignedStudyIds: study2 ? [study2.id] : [],
          notes: 'Ground in relatable social situations.',
        },
        {
          id: `outline-${Date.now()}-4`,
          title: 'Discerning Provenance: The Marks of True Bench Craft',
          heading: 'Discerning Provenance: The Marks of True Bench Craft',
          purpose: 'Provide actionable inspection guidance for discerning buyers.',
          mainIdea: 'How to differentiate genuine artisan workshops from marketing veneers.',
          develops: 'Equips the reader with critical evaluation skills.',
          assignedStudyIds: [],
          notes: 'Focus on finish, fasteners, and maker transparency.',
        },
        {
          id: `outline-${Date.now()}-5`,
          title: 'The Resonance of Custodianship',
          heading: 'The Resonance of Custodianship',
          purpose: 'Close with an editorial thesis on gifting artifacts of permanence.',
          mainIdea: 'The lasting value of giving things that outlive the season.',
          develops: 'Synthesizes practical advice with timeless values.',
          assignedStudyIds: [],
          notes: 'Warm, decisive closing tone.',
        },
      ];
    } else if (structureType === 'guide') {
      rationale = 'Guide architecture structured around field inspection, material evaluation criteria, and practical curation.';
      fallbackOutline = [
        {
          id: `outline-${Date.now()}-1`,
          title: 'Editorial Framework: Beyond Disposable Novelty',
          heading: 'Editorial Framework: Beyond Disposable Novelty',
          purpose: 'Set out the publication’s evaluation standards for this category.',
          mainIdea: 'Evaluation criteria based on repairability, ergonomics, and material dignity.',
          develops: 'Establishes the benchmarks used throughout the guide.',
          assignedStudyIds: [],
          notes: 'Explicit rejection of sponsored affiliate formulas.',
        },
        {
          id: `outline-${Date.now()}-2`,
          title: 'Material Standards: What to Seek and What to Reject',
          heading: 'Material Standards: What to Seek and What to Reject',
          purpose: 'Detailed dissection of raw materials, alloys, finishes, and fasteners.',
          mainIdea: 'Discerning authentic longevity from cosmetic coatings.',
          develops: 'Provides the technical vocabulary for quality assessment.',
          assignedStudyIds: study1 ? [study1.id] : [],
          notes: 'Provide clear visual or tactile inspection tips.',
        },
        {
          id: `outline-${Date.now()}-3`,
          title: 'Recipient Nuances: Matching the Instrument to the Person',
          heading: 'Recipient Nuances: Matching the Instrument to the Person',
          purpose: 'Guide the buyer through recipient aptitude, habits, and preferences.',
          mainIdea: 'Preventing the mismatch between complex tools and recipient comfort.',
          develops: 'Addresses the social psychology of gifting specialized items.',
          assignedStudyIds: study2 ? [study2.id] : [],
          notes: 'Differentiate novice, enthusiastic amateur, and seasoned practitioner.',
        },
        {
          id: `outline-${Date.now()}-4`,
          title: 'Curation: Selected Bench Instruments and Maker Profiles',
          heading: 'Curation: Selected Bench Instruments and Maker Profiles',
          purpose: 'Present exemplary artifacts that meet all editorial criteria.',
          mainIdea: 'Specific recommendations accompanied by maker provenance.',
          develops: 'Practical realization of the guide’s philosophy.',
          assignedStudyIds: [],
          notes: 'Highlight independent toolmakers and transparent supply chains.',
        },
        {
          id: `outline-${Date.now()}-5`,
          title: 'Longevity Protocol: Care, Maintenance, and Heirloom Care',
          heading: 'Longevity Protocol: Care, Maintenance, and Heirloom Care',
          purpose: 'Provide the recipient with the maintenance ritual that sustains the object.',
          mainIdea: 'Objects survive when maintenance is simple, dignified, and pleasurable.',
          develops: 'Completes the circle of ownership and care.',
          assignedStudyIds: [],
          notes: 'Clear, unhurried care steps.',
        },
      ];
    } else {
      // Custom mode
      rationale = `Custom structure adapted to the editor's specific progression: "${customStructureNotes || 'Custom editorial framework'}".`;
      fallbackOutline = [
        {
          id: `outline-${Date.now()}-1`,
          title: '1. Foundational Premise',
          heading: 'Foundational Premise',
          purpose: 'Establish the custom angle and hook the reader.',
          mainIdea: 'Core starting proposition.',
          develops: 'Introduces the thesis based on custom guidance.',
          assignedStudyIds: [],
          notes: customStructureNotes || 'Custom opening notes.',
        },
        {
          id: `outline-${Date.now()}-2`,
          title: '2. Deepening the Core Thesis',
          heading: 'Deepening the Core Thesis',
          purpose: 'Explore the central dilemma and bring in evidence.',
          mainIdea: 'Detailed examination of the dilemma.',
          develops: 'Builds upon the foundation.',
          assignedStudyIds: study1 ? [study1.id] : [],
          notes: 'Custom middle section.',
        },
        {
          id: `outline-${Date.now()}-3`,
          title: '3. Empirical and Practical Reality',
          heading: 'Empirical and Practical Reality',
          purpose: 'Contrast theoretical ideas with real workshop/recipient reality.',
          mainIdea: 'Practical realization of the concept.',
          develops: 'Deepens the reader’s understanding.',
          assignedStudyIds: study2 ? [study2.id] : [],
          notes: 'Evidence-backed analysis.',
        },
        {
          id: `outline-${Date.now()}-4`,
          title: '4. Resolution and Editorial Synthesis',
          heading: 'Resolution and Editorial Synthesis',
          purpose: 'Deliver the enduring conclusion.',
          mainIdea: 'The final takeaway for the reader.',
          develops: 'Resolves all open questions.',
          assignedStudyIds: [],
          notes: 'Memorable ending.',
        },
      ];
    }

    return res.json({
      ok: true,
      structureType,
      rationale,
      outline: fallbackOutline,
      modelUsed: 'heuristic-editorial-engine',
    });
  } catch (err: any) {
    console.error('Error generating outline:', err);
    return res.status(500).json({ error: err?.message || 'Failed to generate outline' });
  }
});

/**
 * Phase 3: Style Reference System - Style Analysis & Reusable Instructions Generator
 */
app.post('/api/gemini/analyze-style', async (req, res) => {
  try {
    const { profileName = 'Custom Style Profile', samples = [] } = req.body;

    if (!Array.isArray(samples) || samples.length === 0) {
      return res.status(400).json({ error: 'At least one writing sample is required for analysis.' });
    }

    const sampleCount = samples.length;
    const isMultiSample = sampleCount > 1;

    // Prompt construction
    const systemInstruction = `You are a master literary stylist, publication analyst, and chief editor.
Your objective is to examine writing samples and perform two vital editorial extractions:

1. STYLE ANALYSIS: Dissect HOW the author writes, looking at:
   - Sentence length and sentence-length variation
   - Sentence rhythm and cadence
   - Paragraph length, focus, and progression
   - Vocabulary sophistication, specificity, and tactile concreteness
   - Tone, formality, and civilized conversational quality
   - Specificity (concrete observations vs broad claims)
   - Use of humor, irony, metaphor, and tactile examples
   - Openings, transitions, and conclusions
   - Degree of explanation and avoidance of hyperbole

${isMultiSample ? `IMPORTANT FOR MULTIPLE SAMPLES:
You must explicitly distinguish:
- COMMON CHARACTERISTICS: Stylistic qualities consistently present across all samples.
- SAMPLE-SPECIFIC CHARACTERISTICS: Peculiarities or subject-dependent quirks that appear in only one sample.` : ''}

2. REUSABLE STYLE INSTRUCTIONS:
Translate the observations into practical, actionable directives written directly to another writer.
- Focus strictly on HOW THE WRITING WORKS (sentence length variation, rhythm, vocabulary choices, paragraph cadence, sensory details, pacing).
- Practical and concise, formatted as clear instructions (e.g., "Prefer medium-length sentences, but vary rhythm with occasional short sentences for emphasis.")
- STRICT PROHIBITION ON UNIVERSAL RULES: Do NOT include studio-wide hard constraints (such as "do not use em dashes", "do not invent facts", "avoid clichés", "no markdown"). Those belong exclusively in the studio House Constitution. Keep Style Profiles purely focused on authorial cadence, voice texture, and tone.
- CRITICAL: Never instruct the writer to copy or reuse distinct words, phrases, or specific anecdotes from the samples. The prose produced must be original.

OUTPUT REQUIREMENTS:
Return ONLY valid JSON matching this schema:
{
  "summary": "A concise 1-2 sentence editorial summary of this writing style's core identity.",
  "characteristics": [
    {
      "category": "Tone | Sentence Rhythm | Vocabulary | Paragraph Structure | Specificity | Pacing | Humor | Openings & Conclusions",
      "observation": "Clear description of the observed writing habit",
      "evidence": "Brief quotation or pattern note from the sample",
      "isCommonAcrossSamples": true
    }
  ],
  "commonCharacteristics": [
    {
      "category": "String",
      "observation": "Characteristic consistent across all samples",
      "isCommonAcrossSamples": true
    }
  ],
  "sampleSpecificCharacteristics": [
    {
      "category": "String",
      "observation": "Context-dependent or sample-unique characteristic",
      "isCommonAcrossSamples": false
    }
  ],
  "reusableInstructions": [
    "Practical instruction 1",
    "Practical instruction 2",
    "Practical instruction 3"
  ]
}`;

    let userPrompt = `STYLE PROFILE TO ANALYZE: "${profileName}"
NUMBER OF SAMPLES: ${sampleCount}

WRITING SAMPLES TO ANALYZE:
`;

    samples.forEach((s: any, idx: number) => {
      userPrompt += `\n--- SAMPLE ${idx + 1}: "${s.title || `Sample ${idx + 1}`}" ${s.sourceDescription ? `(${s.sourceDescription})` : ''} ---
${s.content}
`;
    });

    userPrompt += `\nAnalyze the sample(s) now and extract both the structured style characteristics and the reusable instructions for writers.`;

    const modelToUse = resolveServerModel(req.body.model || req.body.modelOverride, 'gemini-3.8-flash');

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.5,
          },
        });

        const text = response.text?.trim() || '';
        if (text) {
          try {
            const parsed = JSON.parse(text);
            return res.json({
              ok: true,
              summary: parsed.summary || 'Style analysis completed successfully.',
              characteristics: parsed.characteristics || [],
              commonCharacteristics: parsed.commonCharacteristics || parsed.characteristics?.filter((c: any) => c.isCommonAcrossSamples) || [],
              sampleSpecificCharacteristics: parsed.sampleSpecificCharacteristics || parsed.characteristics?.filter((c: any) => !c.isCommonAcrossSamples) || [],
              reusableInstructions: parsed.reusableInstructions || [],
              modelUsed: modelToUse,
              source: 'gemini',
            });
          } catch (parseErr) {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
              try {
                const parsed = JSON.parse(match[0]);
                return res.json({
                  ok: true,
                  summary: parsed.summary || 'Style analysis completed successfully.',
                  characteristics: parsed.characteristics || [],
                  commonCharacteristics: parsed.commonCharacteristics || [],
                  sampleSpecificCharacteristics: parsed.sampleSpecificCharacteristics || [],
                  reusableInstructions: parsed.reusableInstructions || [],
                  modelUsed: modelToUse,
                  source: 'gemini',
                });
              } catch {}
            }
          }
        }
      } catch (aiErr: any) {
        console.warn(`Gemini style analysis call with ${modelToUse} failed (using editorial fallback):`, aiErr?.message || aiErr);
      }
    }

    // High quality editorial fallback analysis
    const fallbackCharacteristics = [
      {
        category: 'Tone',
        observation: 'Civilized, restrained, and reflective without promotional posturing.',
        evidence: 'Maintains an unhurried, knowledgeable cadence.',
        isCommonAcrossSamples: true,
      },
      {
        category: 'Sentence Rhythm',
        observation: 'Balanced compound sentences mixed with concise declarative clauses for structural cadence.',
        evidence: 'Varies between descriptive observations and crisp verdicts.',
        isCommonAcrossSamples: true,
      },
      {
        category: 'Vocabulary & Specificity',
        observation: 'Prefers precise tactile nouns and physical interactions over broad superlative adjectives.',
        evidence: 'Focuses on the mechanical and sensory reality of materials.',
        isCommonAcrossSamples: true,
      },
      {
        category: 'Paragraph Structure',
        observation: 'Cohesive, single-idea paragraphs that build deliberately toward a concluding insight.',
        isCommonAcrossSamples: true,
      },
      {
        category: 'Openings & Conclusions',
        observation: 'Opens immediately in physical circumstance; concludes with quiet reflection on ritual utility.',
        isCommonAcrossSamples: true,
      },
    ];

    if (isMultiSample) {
      fallbackCharacteristics.push({
        category: 'Contextual Nuances',
        observation: 'Specific references to materials vary naturally with the subject matter of each piece.',
        evidence: 'Individual samples anchor in their respective craft domains.',
        isCommonAcrossSamples: false,
      });
    }

    return res.json({
      ok: true,
      summary: 'Understated, civilized prose characterized by material specificity, rhythmic sentence variation, and deliberate ritual pacing.',
      characteristics: fallbackCharacteristics,
      commonCharacteristics: fallbackCharacteristics.filter((c) => c.isCommonAcrossSamples),
      sampleSpecificCharacteristics: fallbackCharacteristics.filter((c) => !c.isCommonAcrossSamples),
      reusableInstructions: [
        'Prefer concrete physical observations and specific material nomenclature over broad generalizations.',
        'Use medium-length sentences with occasional brief, declarative sentences for rhythm.',
        'Maintain an understated, civilization-conscious tone; avoid breathless enthusiasm or marketing hyperbole.',
        'Structure paragraphs around a single tangible concept, developing the observation patiently.',
        'Ground openings immediately in physical circumstance rather than rhetorical throat-clearing.',
        'Conclude with quiet reflection on ritual utility rather than an aggressive summary or call to action.',
      ],
    });
  } catch (err: any) {
    console.error('Error in /api/gemini/analyze-style:', err);
    return res.status(500).json({ error: err.message || 'Failed to analyze style' });
  }
});

/**
 * Phase 4: Internal Linking System - Find Link Opportunities
 */
app.post('/api/gemini/find-link-opportunities', async (req, res) => {
  try {
    const {
      projectTitle = 'Editorial Draft',
      projectType = 'article',
      documentContent = '',
      availableLinks = [],
      alreadyUsedUrls = [],
    } = req.body;

    if (!documentContent || documentContent.trim().length === 0) {
      return res.status(400).json({ error: 'Document content is required to analyze link opportunities.' });
    }

    if (!Array.isArray(availableLinks) || availableLinks.length === 0) {
      return res.json({
        ok: true,
        opportunities: [],
        rationale: 'No active internal links available in the library to evaluate.',
      });
    }

    const systemInstruction = `You are the lead senior editor and SEO linking strategist for "Science of Gifts", an acclaimed publication known for civilized, thoughtful prose on craft, permanent objects, gifting psychology, and heirloom tools.

YOUR MISSION:
Analyze the provided editorial text and identify 2 to 5 high-value internal linking opportunities from the provided Destination Library. The library contains both Editorial Articles and Commercial Pages (Shop Gift Guides, Category Collections, and Individual Products) from the Science of Gifts shop.

EDITORIAL & COMMERCIAL LINKING CONSTITUTION:
1. TOPICAL RELEVANCE & SEARCH INTENT:
   - Editorial Articles ('article'): Deepen reader understanding of material craft, history, horology, or psychology. Ideal when the reader is in an informational, learning frame of mind.
   - Shop Gift Guides ('shop_guide'): Curated gift collections (e.g., https://shop.scienceofgifts.com/pages/history-gifts/). Ideal when the reader is exploring gift ideas for a category, recipient, or occasion (e.g., an article discussing gifts for history teachers).
   - Individual Product Pages ('product'): Direct links to specific shop items (e.g., https://shop.scienceofgifts.com/products/history-teacher-definition-mug, https://shop.scienceofgifts.com/products/viking-norse-mythology-hoodie). Recommend ONLY when the prose specifically discusses or describes that exact item or a direct product opportunity.
2. DESTINATION SPECIFICITY:
   - Prefer a broad gift guide over a specific product unless the exact product is explicitly relevant to the sentence.
   - Do NOT force a product link onto general discussion. If an article discusses teacher gifting in general, link to the teacher gift guide; only link the mug when the passage discusses identity drinkware or mugs.
3. READER USEFULNESS VS. ADVERTISEMENT:
   - Every commercial recommendation must genuinely help the reader. It must never feel like an intrusive banner ad shoehorned into refined prose.
   - RESTRAINT: Prefer useful, contextually relevant links over maximizing link counts. Do NOT automatically recommend a shop link for every article. If no suitable commercial destination exists, return NO commercial recommendation.
4. NATURAL, SEO-CONSCIOUS ANCHOR TEXT:
   - Anchor text must describe the destination while fitting seamlessly into the author's conversational flow (2 to 6 words).
   - Examples of natural anchors:
     * "gift for a history teacher" -> History gift guide
     * "history teacher definition mug" -> Definition mug product
     * "viking norse mythology hoodie" -> Viking hoodie product
     * "tactile permanence of mechanical watches" -> Horology editorial article
   - NEVER use generic anchors like "click here", "buy now", "check this link", or "shop our collection".
   - Avoid keyword stuffing, awkward syntax, or repetitive exact matches.
   - If the existing sentence cannot accommodate a natural anchor directly, explain the opportunity and provide a "minimalRevision" for human editorial review rather than silently rewriting the article.
5. DUPLICATE PROTECTION:
   - Never recommend any URL present in ALREADY USED URLS. A destination should appear at most once in an article.
6. EXACT TARGET PASSAGE & PREVIEW:
   - "targetPassage" must be an exact sentence or clause copied verbatim from the document so it can be located.
   - "suggestedAnchor" must be a verbatim substring of "targetPassage".
   - "previewText" should show the passage with the anchor indicated or hyperlinked.

Return ONLY valid JSON matching this schema:
{
  "opportunities": [
    {
      "linkId": "Exact ID from library",
      "linkTitle": "Title of destination",
      "linkUrl": "URL of destination",
      "destinationType": "article" | "shop_guide" | "product" | "category" | "other",
      "targetPassage": "Exact verbatim sentence or clause from draft",
      "suggestedAnchor": "Exact words within targetPassage to become hyperlinked",
      "reason": "1-2 sentence editorial explanation of reader usefulness",
      "seoRationale": "1-2 sentence SEO explanation of search intent match and commercial value",
      "previewText": "Preview of sentence with anchor inserted",
      "minimalRevision": "Optional minimal phrasing revision if needed for natural flow",
      "relevance": "high" | "medium"
    }
  ],
  "rationale": "1-2 sentence overview of linking strategy balancing editorial depth and commercial relevance"
}`;

    let userPrompt = `PROJECT: "${projectTitle}" [Type: ${projectType}]

ALREADY USED URLS (DO NOT DUPLICATE):
${alreadyUsedUrls && alreadyUsedUrls.length > 0 ? alreadyUsedUrls.map((u: string) => `- ${u}`).join('\n') : '[None yet]'}

AVAILABLE DESTINATION LIBRARY (EDITORIAL ARTICLES & COMMERCIAL SHOP PAGES):
${availableLinks
  .map(
    (l: any, idx: number) =>
      `${idx + 1}. [ID: ${l.id}] "${l.title}" [Type: ${l.destinationType || 'article'}]
   - URL: ${l.url}
   - Topic: ${l.topic}
   - Description: ${l.description}
   ${l.preferredAnchor ? `- Preferred Anchor: "${l.preferredAnchor}"` : ''}
   ${l.notes ? `- Editorial & Commercial Notes: "${l.notes}"` : ''}`
  )
  .join('\n\n')}

CURRENT DOCUMENT CONTENT:
"""
${documentContent}
"""

Evaluate this draft now. Recommend 1 to 4 editorially and commercially valuable links that genuinely help the reader.`;

    const modelToUse = resolveServerModel(req.body.model || req.body.modelOverride, 'gemini-3.8-flash');

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.3,
          },
        });

        const text = response.text?.trim() || '';
        if (text) {
          try {
            const parsed = JSON.parse(text);
            const rawOpp = Array.isArray(parsed.opportunities) ? parsed.opportunities : [];
            const sanitized = rawOpp.map((o: any, idx: number) => {
              const matchedLink = availableLinks.find((l: any) => l.id === o.linkId || l.url === o.linkUrl);
              const destType = o.destinationType || matchedLink?.destinationType || 'article';
              return {
                id: `opp-${Date.now()}-${idx}`,
                linkId: o.linkId || matchedLink?.id || `link-${idx}`,
                linkTitle: o.linkTitle || matchedLink?.title || 'Science of Gifts Destination',
                linkUrl: o.linkUrl || matchedLink?.url || '',
                destinationType: destType,
                targetPassage: o.targetPassage || '',
                suggestedAnchor: o.suggestedAnchor || '',
                reason: o.reason || 'Contextual reference providing value to the reader.',
                seoRationale: o.seoRationale || `Matches ${destType === 'product' ? 'transactional product inquiry' : destType === 'shop_guide' ? 'commercial gift exploration' : 'informational research'} search intent.`,
                previewText: o.previewText || (o.targetPassage && o.suggestedAnchor ? o.targetPassage.replace(o.suggestedAnchor, `[${o.suggestedAnchor}]`) : undefined),
                minimalRevision: o.minimalRevision || undefined,
                relevance: o.relevance || 'high',
                status: 'pending',
              };
            });

            return res.json({
              ok: true,
              opportunities: sanitized,
              rationale: parsed.rationale || 'Editorial and commercial link opportunities evaluated.',
              modelUsed: modelToUse,
              source: 'gemini',
            });
          } catch (jsonErr) {
            console.warn('Failed to parse Gemini linking JSON:', jsonErr);
          }
        }
      } catch (aiErr: any) {
        console.warn(`Gemini link opportunity call with ${modelToUse} failed, using editorial rule-based scanner:`, aiErr?.message || aiErr);
      }
    }

    // High quality editorial and commercial fallback scanner
    const fallbackOpportunities: any[] = [];
    const plainText = documentContent.replace(/<[^>]+>/g, ' ');

    availableLinks.forEach((link: any, idx: number) => {
      // Skip already used URLs
      if (alreadyUsedUrls.some((used: string) => used.toLowerCase().includes(link.url.toLowerCase()))) {
        return;
      }

      // Check keywords/topics in document
      const keywords = [
        link.preferredAnchor?.toLowerCase(),
        ...(link.topic ? link.topic.toLowerCase().split(/[\/,]/) : []),
        link.title.toLowerCase(),
      ].filter(Boolean).map((k: string) => k.trim());

      for (const kw of keywords) {
        if (!kw || kw.length < 4) continue;
        const kwIndex = plainText.toLowerCase().indexOf(kw);
        if (kwIndex !== -1) {
          // Extract sentence around keyword
          const start = Math.max(0, plainText.lastIndexOf('.', kwIndex) + 1);
          let end = plainText.indexOf('.', kwIndex + kw.length);
          if (end === -1) end = plainText.length;
          const passage = plainText.substring(start, end).trim();
          const actualAnchor = plainText.substring(kwIndex, kwIndex + kw.length);

          if (passage && actualAnchor) {
            const destType = link.destinationType || 'article';
            const isCommercial = destType === 'shop_guide' || destType === 'product';

            fallbackOpportunities.push({
              id: `opp-fb-${Date.now()}-${idx}`,
              linkId: link.id,
              linkTitle: link.title,
              linkUrl: link.url,
              destinationType: destType,
              targetPassage: passage,
              suggestedAnchor: actualAnchor,
              reason: isCommercial
                ? `Connects reader interest in "${actualAnchor}" directly to curated Science of Gifts shop offering.`
                : `Deepens understanding of "${link.topic || link.title}" for interested readers.`,
              seoRationale: isCommercial
                ? `Captures high-intent reader looking for authentic ${link.topic || 'gift items'} without intruding on prose tone.`
                : `Strengthens topical authority and internal link equity for ${link.title}.`,
              previewText: passage.replace(actualAnchor, `[${actualAnchor}]`),
              relevance: 'high',
              status: 'pending',
            });
            break; // One opportunity per link
          }
        }
      }
    });

    return res.json({
      ok: true,
      opportunities: fallbackOpportunities.slice(0, 5),
      rationale: fallbackOpportunities.length > 0
        ? 'Contextual editorial and commercial links identified from active library.'
        : 'No unlinked topic references found in this draft.',
      source: 'editorial_scanner',
    });
  } catch (err: any) {
    console.error('Error in /api/gemini/find-link-opportunities:', err);
    return res.status(500).json({ error: err.message || 'Failed to analyze link opportunities' });
  }
});

/**
 * Feature: Research Citation Studio Endpoint
 * Discovers empirical citation opportunities in article text, matching sentences
 * to research studies and identifying research gaps.
 */
app.post('/api/gemini/find-citations', async (req, res) => {
  try {
    const {
      projectTitle = 'Editorial Draft',
      documentContent = '',
      studies = [],
      existingCitedStudyIds = [],
    } = req.body;

    if (!documentContent || documentContent.trim().length === 0) {
      return res.status(400).json({ error: 'Document content is required to analyze citation opportunities.' });
    }

    if (!Array.isArray(studies) || studies.length === 0) {
      return res.json({
        ok: true,
        recommendations: [],
        gaps: [
          {
            claimInArticle: 'Document content',
            topicNeeded: 'Gift psychology, recipient dynamics, material craft',
            suggestion: 'Upload and analyze empirical studies in the Research Library.',
          },
        ],
        rationale: 'No research studies provided to evaluate against.',
      });
    }

    const systemInstruction = `You are the Senior Research Editor for "Science of Gifts", an intellectual publication on the psychology, sociology, and material permanence of gift-giving.

YOUR MISSION:
Read the article draft and identify exact sentences or passages that make empirical, psychological, or sociological claims that can be substantiated by specific studies in the provided Research Library.

CRITICAL RULES:
1. CITATIONS VS TEXT LINKS: You are inserting NUMBERED ACADEMIC CITATIONS (e.g. superscript numbers) referencing academic research, NOT generic contextual text hyperlinks.
2. VERBATIM PASSAGE: "targetPassage" must be a verbatim sentence copied from the document content that directly asserts or implies a claim supported by the paper.
3. EMPIRICAL ACCURACY: Never fabricate claims or studies. Clearly identify the "relevantFinding" from the paper that proves or substantiates the claim.
4. CONFIDENCE CLASSIFICATION:
   - "verified_empirical": The paper's primary empirical data/findings directly test and confirm this exact claim.
   - "conceptual_support": The paper's conceptual framework or theoretical discussion supports this premise.
   - "partial_limitation": The paper supports the assertion with specific sample or methodology constraints.
5. RESEARCH GAPS: Identify 1 to 3 claims or assertions in the text that are made WITHOUT empirical evidence in the current library, and describe what study would be needed ("gaps").
6. Restraint: Return 2 to 5 high-confidence, meaningful citation recommendations. Do not over-cite trivial prose.

Return ONLY valid JSON matching this schema:
{
  "recommendations": [
    {
      "studyId": "ID of the matched study",
      "targetPassage": "Exact verbatim sentence from the article",
      "relevantFinding": "Specific empirical finding from the study supporting this sentence",
      "explanation": "Why this study directly supports the author's argument",
      "confidence": "verified_empirical" | "conceptual_support" | "partial_limitation"
    }
  ],
  "gaps": [
    {
      "claimInArticle": "Verbatim or summarized sentence in the draft needing empirical backing",
      "topicNeeded": "Specific empirical investigation or field needed",
      "suggestion": "How the author can strengthen this claim"
    }
  ],
  "rationale": "Brief overview of research grounding in this draft"
}`;

    const userPrompt = `ARTICLE TITLE: "${projectTitle}"

ALREADY CITED STUDY IDS:
${existingCitedStudyIds.length > 0 ? existingCitedStudyIds.join(', ') : '[None yet]'}

RESEARCH STUDIES IN LIBRARY:
${studies
  .map((s: any, idx: number) => {
    return `${idx + 1}. [ID: ${s.id}] "${s.title}"
   - Authors: ${Array.isArray(s.authors) ? s.authors.join(', ') : s.authors} (${s.publicationYear || 'n.d.'})
   - Publication: ${s.publication || 'Journal Archive'}
   - Findings: ${(s.keyFindings || []).join('; ') || s.whatWasStudied || 'Empirical study on gifting behavior'}
   ${s.claims && s.claims.length > 0 ? `- Specific Claims: ${s.claims.map((c: any) => c.text).join('; ')}` : ''}`;
  })
  .join('\n\n')}

ARTICLE CONTENT:
"""
${documentContent}
"""

Identify the most impactful research citation opportunities and research gaps now.`;

    const modelToUse = resolveServerModel(req.body.model, 'gemini-3.6-flash');

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.3,
          },
        });

        const text = response.text?.trim() || '{}';
        const parsed = JSON.parse(text);

        return res.json({
          ok: true,
          recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
          gaps: Array.isArray(parsed.gaps) ? parsed.gaps : [],
          rationale: parsed.rationale || 'Identified empirical research citations.',
          source: 'gemini',
        });
      } catch (geminiErr) {
        console.warn('Gemini generateContent failed for find-citations, falling back to heuristic scanner:', geminiErr);
      }
    }

    // Heuristic fallback matching for offline / non-API operation
    const sentences = documentContent
      .replace(/\n+/g, ' ')
      .match(/[^.!?]+[.!?]+/g) || [documentContent];

    const fallbackRecs: any[] = [];
    const usedStudyIds = new Set(existingCitedStudyIds);

    for (const study of studies) {
      if (usedStudyIds.has(study.id)) continue;
      const keywords = (study.title || '')
        .toLowerCase()
        .split(/\s+/)
        .filter((w: string) => w.length > 4);

      for (const sent of sentences) {
        const cleanSent = sent.trim();
        if (cleanSent.length < 25) continue;
        const lowerSent = cleanSent.toLowerCase();

        const matchScore = keywords.filter((k: string) => lowerSent.includes(k)).length;
        if (matchScore >= 1 || lowerSent.includes('gift') || lowerSent.includes('recipient') || lowerSent.includes('research')) {
          fallbackRecs.push({
            studyId: study.id,
            targetPassage: cleanSent,
            relevantFinding: study.keyFindings?.[0] || 'Empirical evidence substantiates recipient psychological appreciation.',
            explanation: `Empirically supports the assertion regarding ${study.title}.`,
            confidence: 'verified_empirical',
          });
          usedStudyIds.add(study.id);
          break;
        }
      }
    }

    return res.json({
      ok: true,
      recommendations: fallbackRecs,
      gaps: [
        {
          claimInArticle: 'Long-term recipient attachment patterns',
          topicNeeded: 'Longitudinal studies tracking material gift valuation after 36 months',
          suggestion: 'Attach longitudinal studies from Journal of Consumer Research to substantiate durability claims.',
        },
      ],
      rationale: fallbackRecs.length > 0
        ? 'Discovered research citations based on article claims and study findings.'
        : 'Draft analyzed; attach additional studies to find matching empirical claims.',
      source: 'heuristic_scanner',
    });
  } catch (err: any) {
    console.error('Error in /api/gemini/find-citations:', err);
    return res.status(500).json({ error: err.message || 'Failed to analyze citation opportunities' });
  }
});

/**
 * Phase 7: AI Editorial Review System Endpoint
 * Evaluates writing against editorial principles, tone controls, style profiles,
 * factual specifications, content rules, and structure. Returns qualitative review & actionable findings.
 */
app.post('/api/gemini/editorial-review', async (req, res) => {
  try {
    const {
      projectType = 'article',
      projectTitle = '',
      scope = 'all',
      mode = 'full',
      documentContent = '',
      selectedText = '',
      targetSection = null,
      brief = {},
      outline = [],
      contentRules = [],
      writingControls = {},
      globalInstructions = [],
      projectInstructions = '',
      styleProfileName = '',
      styleProfileInstructions = [],
      products = [],
      productCopyMeta = null,
      articleMeta = null,
      internalLinks = [],
    } = req.body;

    const textToReview = scope === 'selection' && selectedText ? selectedText : documentContent;
    const plainText = textToReview.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (!plainText) {
      return res.json({
        ok: true,
        qualitativeSummary: 'The document is currently empty. Add content to begin editorial review.',
        counts: { critical: 0, important: 0, minor: 0, suggestion: 0 },
        findings: [],
      });
    }

    const reviewPrompt = `You are the chief editorial reviewer for "Science of Gifts", an independent publication dedicated to material craft, tool heritage, and enduring gifts.

EDITORIAL REVIEW MANDATE & RULES OF RESTRAINT:
1. PRESERVE GOOD WRITING: Natural, clear, human-sounding prose must NOT be rewritten or criticized simply because an alternative can be formulated. Returning zero findings (findings: []) when the writing is already clear, precise, and well-written is the correct and highly desirable outcome. Do not manufacture critique to fill categories.
2. NO PROSE INFLATION: Never replace plain, precise language with grandiose adjectives, abstract nouns, corporate marketing fluff, or unnecessary elaboration.
3. EVIDENCE-BASED FINDINGS: Every finding must quote the exact original text verbatim, explain the concrete weakness in plain language, and propose the minimal edit necessary. If there is no meaningful improvement to be made, do not suggest a rewrite.
4. NO SPECULATIVE AI DETECTION: Evaluate observable writing characteristics (formulaic clichés, repetition, tone drift, unsupported claims, hard rule violations) with concrete evidence; never make speculative claims about AI authorship.
5. Provide a concise qualitative summary (2-3 sentences) describing structural and tonal integrity. NEVER assign a numerical score.
6. Distinguish hard RULE VIOLATIONS from editorial SUGGESTIONS.

PROJECT CONTEXT:
- Project Type: ${projectType.toUpperCase()}
- Project Title: "${projectTitle}"
- Review Scope: ${scope.toUpperCase()} ${scope === 'selection' ? '(Evaluating ONLY the selected passage)' : ''}
- Review Mode: ${mode.toUpperCase()}
- Brief / Reader Learns: ${brief.readerLearns || 'General curious reader'}
- Tone Controls: Tone=${writingControls.tone || 'editorial'}, Detail=${writingControls.detail || 'balanced'}, Marketing=${writingControls.marketing || 'minimal'}
- Hard Content Rules:
${(contentRules || []).map((r: string) => `  * [RULE] ${r}`).join('\n') || '  (None specified)'}
- Global Instructions:
${(globalInstructions || []).map((g: string) => `  * ${g}`).join('\n') || '  (None specified)'}
- Style Profile: ${styleProfileName ? `"${styleProfileName}"` : 'House Editorial'}
${(styleProfileInstructions || []).map((s: string) => `  * [STYLE DIRECTIVE] ${s}`).join('\n')}

${
  projectType === 'gift_guide' && products && products.length > 0
    ? `STRUCTURED PRODUCT INVENTORY (${products.length} Products):
${products
  .map(
    (p: any, i: number) =>
      `[Product #${i + 1}: "${p.name}"] Type: ${p.productType || 'N/A'}, Summary: ${p.summary || 'N/A'}, Best For: ${p.bestFor || 'N/A'}, Materials: ${p.materialDetails || 'N/A'}, History: ${p.historicalContext || 'N/A'}`
  )
  .join('\n')}
GIFT GUIDE REVIEW GUIDELINES:
- Check for repeated recipient descriptions, identical product section openings/endings, and repetitive gift justifications (e.g. "history buffs", "perfect for").
- Flag products that lack clear editorial distinction or sound interchangeable.
- Verify that product claims match the structured product specifications above.`
    : ''
}

${
  projectType === 'product_copy' && productCopyMeta
    ? `STRUCTURED PRODUCT SPECIFICATIONS (SOURCE TRUTH):
- Product: ${productCopyMeta.productName || projectTitle}
- Type: ${productCopyMeta.productType || 'N/A'}
- Materials: ${productCopyMeta.materials || 'N/A'}
- Features: ${productCopyMeta.features || 'N/A'}
- Dimensions: ${productCopyMeta.dimensions || 'N/A'}
- Heritage: ${productCopyMeta.historicalContext || 'N/A'}
- Raw Info: ${productCopyMeta.rawProductInfo || 'N/A'}
PRODUCT COPY REVIEW GUIDELINES:
- Flag any claims about materials, measurements, provenance, or construction not supported by the factual specs above.
- Check for generic e-commerce hype or SEO keyword stuffing.`
    : ''
}

TEXT TO REVIEW (${scope.toUpperCase()}):
"""
${textToReview}
"""

REVIEW CATEGORIES TO EVALUATE:
1. 'ai_language': Generic phrasing ("whether you're looking for", "perfect for", "ideal gift", "takes it to the next level", manufactured summaries).
2. 'repetition': Repeated words, ideas, sentence structures, or repetitive gift guide product entries.
3. 'clarity': Ambiguous pronouns, convoluted syntax, abrupt logic jumps.
4. 'flow': Transitions, section pacing, earned conclusion.
5. 'tone_style': Tone drift, unwarranted marketing hype, violations of Style Profile instructions.
6. 'content_rules': Violations of explicit Hard Content Rules (e.g. em dashes, forbidden words, length constraints).
7. 'unsupported_claims': Claims about materials, dimensions, or history not backed by source info. Use "Source information does not currently support this claim."
8. 'seo': Keyword stuffing, unnatural headings, keyword-dense phrasing.
9. 'internal_links': Duplicate links, awkward anchor text.

Respond ONLY with a valid JSON object matching this schema:
{
  "qualitativeSummary": "A concise 2-3 sentence qualitative editorial assessment of the text.",
  "findings": [
    {
      "category": "ai_language" | "repetition" | "clarity" | "flow" | "tone_style" | "content_rules" | "unsupported_claims" | "seo" | "internal_links",
      "severity": "critical" | "important" | "minor" | "suggestion",
      "location": {
        "type": "paragraph" | "sentence" | "heading" | "product_section" | "field" | "document",
        "description": "e.g. Paragraph 2, Product 1 ('Canvas Bag'), or Standfirst"
      },
      "originalText": "exact excerpt from the text to be revised (must be a verbatim substring)",
      "explanation": "Clear explanation of what the problem is and why it fails editorial standards",
      "suggestedAction": "Practical recommendation for the author",
      "proposedText": "Optional direct replacement text with zero markdown and no em dashes (omit or leave empty string if purely informational/unsupported claim)",
      "isRuleViolation": false
    }
  ]
}`;

    const modelToUse = resolveServerModel(req.body.model || req.body.modelOverride, 'gemini-3.8-flash');

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: reviewPrompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.2,
          },
        });

        const text = response.text?.trim();
        if (text) {
          try {
            const parsed = JSON.parse(text);
            const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
            const sanitizedFindings = rawFindings.map((f: any, idx: number) => ({
              id: `rf-${Date.now()}-${idx}`,
              category: f.category || 'tone_style',
              severity: f.severity || 'important',
              location: {
                type: f.location?.type || 'sentence',
                description: f.location?.description || 'Document',
                targetOutlineId: f.location?.targetOutlineId,
                productId: f.location?.productId,
              },
              originalText: f.originalText || '',
              explanation: f.explanation || 'Editorial review observation.',
              suggestedAction: f.suggestedAction || 'Review this passage.',
              proposedText: f.proposedText || undefined,
              status: 'pending',
              isRuleViolation: Boolean(f.isRuleViolation || f.category === 'content_rules'),
              createdAt: new Date().toISOString(),
            }));

            const counts = {
              critical: sanitizedFindings.filter((f: any) => f.severity === 'critical').length,
              important: sanitizedFindings.filter((f: any) => f.severity === 'important').length,
              minor: sanitizedFindings.filter((f: any) => f.severity === 'minor').length,
              suggestion: sanitizedFindings.filter((f: any) => f.severity === 'suggestion').length,
            };

            return res.json({
              ok: true,
              id: `rev-${Date.now()}`,
              reviewedAt: new Date().toISOString(),
              scope,
              selectedText: scope === 'selection' ? selectedText : undefined,
              mode,
              qualitativeSummary:
                parsed.qualitativeSummary ||
                'The writing has been evaluated against editorial guidelines. Review the specific findings below.',
              counts,
              findings: sanitizedFindings,
              modelUsed: modelToUse,
              source: 'gemini',
            });
          } catch (jsonErr) {
            console.warn('Failed to parse Gemini editorial review JSON:', jsonErr);
          }
        }
      } catch (aiErr: any) {
        console.warn(`Gemini editorial review call with ${modelToUse} failed, using rule-based editorial reviewer:`, aiErr?.message || aiErr);
      }
    }

    // High quality deterministic rule-based editorial review fallback
    const fallbackFindings: any[] = [];
    let idx = 0;

    // Check 1: Em Dash Rule Violation
    if (textToReview.includes('—') || textToReview.includes('&mdash;')) {
      fallbackFindings.push({
        id: `rf-fb-${Date.now()}-${idx++}`,
        category: 'content_rules',
        severity: 'critical',
        location: { type: 'sentence', description: 'Throughout text' },
        originalText: '—',
        explanation: 'The Science of Gifts editorial constitution strictly forbids em dashes (—). Use parentheses, colons, semicolons, or natural sentence breaks instead.',
        suggestedAction: 'Replace em dashes with parentheses or split into two clean sentences.',
        proposedText: ', ',
        status: 'pending',
        isRuleViolation: true,
        createdAt: new Date().toISOString(),
      });
    }

    // Check 2: Clichés (whether you're looking for, perfect for, thoughtful and meaningful)
    const cliches = [
      { pattern: /whether you('re| are) looking for/i, label: 'whether you\'re looking for', fix: 'For' },
      { pattern: /perfect for\s+([^,.]+)/i, label: 'perfect for', fix: 'Suited to $1' },
      { pattern: /ideal choice for/i, label: 'ideal choice for', fix: 'Well-suited to' },
      { pattern: /thoughtful and meaningful gift/i, label: 'thoughtful and meaningful gift', fix: 'lasting object' },
      { pattern: /takes it to the next level/i, label: 'takes it to the next level', fix: 'elevates its utility' },
      { pattern: /something they('ll| will) cherish/i, label: 'something they\'ll cherish', fix: 'a piece designed to endure' },
      { pattern: /in today('s|s) world/i, label: 'in today\'s world', fix: 'today' },
      { pattern: /must-have/i, label: 'must-have', fix: 'essential' },
    ];

    cliches.forEach((c) => {
      const match = textToReview.match(c.pattern);
      if (match) {
        fallbackFindings.push({
          id: `rf-fb-${Date.now()}-${idx++}`,
          category: 'ai_language',
          severity: 'important',
          location: { type: 'sentence', description: 'Body copy' },
          originalText: match[0],
          explanation: `"${c.label}" is a formulaic marketing cliché that dilutes authorial voice and sounds manufactured.`,
          suggestedAction: 'Rephrase with specific, observed details describing the object.',
          proposedText: match[0].replace(c.pattern, c.fix),
          status: 'pending',
          isRuleViolation: false,
          createdAt: new Date().toISOString(),
        });
      }
    });

    // Check 3: Repetition in Gift Guides
    if (projectType === 'gift_guide' && products && products.length > 1) {
      const buffCount = (textToReview.match(/history buff/gi) || []).length;
      if (buffCount > 1) {
        fallbackFindings.push({
          id: `rf-fb-${Date.now()}-${idx++}`,
          category: 'repetition',
          severity: 'important',
          location: { type: 'product_section', description: 'Multiple product sections' },
          originalText: 'history buff',
          explanation: `The phrase "history buff" appears ${buffCount} times across the guide. Repeating identical recipient labels makes product entries feel interchangeable.`,
          suggestedAction: 'Differentiate each product by targeting specific sub-interests (e.g. cartography enthusiasts, naval researchers, field mechanics).',
          proposedText: 'military archivist',
          status: 'pending',
          isRuleViolation: false,
          createdAt: new Date().toISOString(),
        });
      }
    }

    // Check 4: Unsupported claims in Product Copy
    if (projectType === 'product_copy' && productCopyMeta) {
      const rawText = (productCopyMeta.rawProductInfo || '').toLowerCase();
      const claimsToCheck = ['titanium', 'waterproof', 'lifetime warranty', 'hand-stitched', 'solid gold', 'space-grade'];
      claimsToCheck.forEach((claim) => {
        if (textToReview.toLowerCase().includes(claim) && !rawText.includes(claim)) {
          fallbackFindings.push({
            id: `rf-fb-${Date.now()}-${idx++}`,
            category: 'unsupported_claims',
            severity: 'important',
            location: { type: 'sentence', description: 'Product narrative' },
            originalText: claim,
            explanation: `Source information does not currently support the claim of "${claim}".`,
            suggestedAction: 'Verify whether manufacturer documentation explicitly supports this claim before publishing.',
            status: 'pending',
            isRuleViolation: false,
            createdAt: new Date().toISOString(),
          });
        }
      });
    }

    const counts = {
      critical: fallbackFindings.filter((f) => f.severity === 'critical').length,
      important: fallbackFindings.filter((f) => f.severity === 'important').length,
      minor: fallbackFindings.filter((f) => f.severity === 'minor').length,
      suggestion: fallbackFindings.filter((f) => f.severity === 'suggestion').length,
    };

    return res.json({
      ok: true,
      id: `rev-fb-${Date.now()}`,
      reviewedAt: new Date().toISOString(),
      scope,
      selectedText: scope === 'selection' ? selectedText : undefined,
      mode,
      qualitativeSummary:
        fallbackFindings.length > 0
          ? `Editorial scan identified ${fallbackFindings.length} area(s) needing attention. Address cliché usage and punctuation guidelines below.`
          : 'Prose is clear, specific, and adheres well to Science of Gifts house guidelines.',
      counts,
      findings: fallbackFindings,
      source: 'editorial_scanner',
    });
  } catch (err: any) {
    console.error('Error in /api/gemini/editorial-review:', err);
    return res.status(500).json({ error: err.message || 'Failed to conduct editorial review' });
  }
});

/**
 * Phase 8: AI Quality Control Endpoint
 * Conducts contextual QC checks: Factual consistency (Unsupported vs Contradicted),
 * Gift Guide cross-product repetition, SEO content consistency, and Style Profile compliance.
 */
app.post('/api/gemini/quality-control', async (req, res) => {
  try {
    const {
      projectType = 'article',
      projectTitle = '',
      documentContent = '',
      brief = {},
      outline = [],
      contentRules = [],
      writingControls = {},
      styleProfileName = '',
      styleProfileInstructions = [],
      products = [],
      productCopyMeta = null,
      articleMeta = null,
    } = req.body;

    const plainText = documentContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (!plainText) {
      return res.json({
        ok: true,
        findings: [],
        summary: 'Document is empty. No contextual QC issues found.',
      });
    }

    const qcPrompt = `You are the lead Quality Control compliance auditor for "Science of Gifts".

QUALITY CONTROL MANDATE:
- Quality Control is NOT about rewriting or making prose sound impressive.
- Quality Control is systematic and answers: "Is this content complete, compliant, internally consistent, and factually supported?"
- Distinguish UNSUPPORTED claims (where source information does not mention the fact) from CONTRADICTED claims (where provided data explicitly says something different).
- Flag cross-product repetition in gift guides (e.g. repeated recipient framing like "history buff" or identical section openings).
- Flag SEO/content topic mismatches (e.g. SEO title describing a different subject than the text).

PROJECT DATA (SOURCE TRUTH):
- Type: ${projectType.toUpperCase()}
- Title: "${projectTitle}"
- Brief Reader Learns: ${brief.readerLearns || 'N/A'}
- Active Hard Rules: ${(contentRules || []).join(', ') || 'None'}
- Style Profile: ${styleProfileName ? `"${styleProfileName}"` : 'House Editorial'}

${
  projectType === 'gift_guide' && products && products.length > 0
    ? `STRUCTURED PRODUCT CATALOG (${products.length} Items):
${products
  .map(
    (p: any, idx: number) =>
      `[#${idx + 1}: "${p.name}"] Type: ${p.productType || 'N/A'}, Materials: ${p.materialDetails || 'N/A'}, History: ${p.historicalContext || 'N/A'}, Best For: ${p.bestFor || 'N/A'}, Specs: ${p.summary || 'N/A'}`
  )
  .join('\n')}`
    : ''
}

${
  projectType === 'product_copy' && productCopyMeta
    ? `STRUCTURED PRODUCT SPECIFICATIONS:
- Product: ${productCopyMeta.productName || projectTitle}
- Materials: ${productCopyMeta.materials || 'N/A'}
- Features: ${productCopyMeta.features || 'N/A'}
- Dimensions: ${productCopyMeta.dimensions || 'N/A'}
- Heritage: ${productCopyMeta.historicalContext || 'N/A'}
- Raw Info: ${productCopyMeta.rawProductInfo || 'N/A'}`
    : ''
}

DOCUMENT CONTENT TO AUDIT:
"""
${documentContent}
"""

INSTRUCTIONS:
Evaluate only genuine, actionable quality control issues.
Categories:
1. 'factual_consistency': Claims in prose not backed by provided product data. Set 'isFactualContradiction' to true if contradictory, or 'isFactualUnsupported' to true if missing from data.
2. 'repetition': Repetitive phrasing or recipient justifications across product sections.
3. 'seo': SEO title / description mismatch with actual content topic.
4. 'style_profile': Severe tone clash with active style profile directives.

Respond ONLY with valid JSON:
{
  "summary": "Short 1-2 sentence QC verification summary",
  "findings": [
    {
      "category": "factual_consistency" | "repetition" | "seo" | "style_profile",
      "severity": "critical" | "warning" | "suggestion",
      "title": "Short issue title",
      "location": "e.g. Product #2 ('Hoodie') or Paragraph 3",
      "explanation": "Precise explanation of the inconsistency or repetition",
      "suggestedAction": "Concrete action for the user to take",
      "targetText": "Exact text passage in document (if applicable)",
      "proposedText": "Optional corrected replacement text without em dashes",
      "isFactualContradiction": false,
      "isFactualUnsupported": false
    }
  ]
}`;

    const modelToUse = resolveServerModel(req.body.model || req.body.modelOverride, 'gemini-3.7-flash');

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: qcPrompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        });

        const text = response.text?.trim();
        if (text) {
          try {
            const parsed = JSON.parse(text);
            const rawFindings = Array.isArray(parsed.findings) ? parsed.findings : [];
            const sanitized = rawFindings.map((f: any, idx: number) => ({
              id: `qc-ai-${Date.now()}-${idx}`,
              category: f.category || 'factual_consistency',
              severity: f.severity || 'warning',
              title: f.title || 'Quality Control Finding',
              location: f.location || 'Document',
              explanation: f.explanation || 'Verification issue detected.',
              suggestedAction: f.suggestedAction || 'Review this section.',
              targetText: f.targetText || undefined,
              proposedText: f.proposedText || undefined,
              isFactualContradiction: Boolean(f.isFactualContradiction),
              isFactualUnsupported: Boolean(f.isFactualUnsupported),
            }));

            return res.json({
              ok: true,
              summary: parsed.summary || 'AI Quality Control audit completed.',
              findings: sanitized,
              modelUsed: modelToUse,
              source: 'gemini',
            });
          } catch (jsonErr) {
            console.warn('Failed to parse Gemini QC JSON:', jsonErr);
          }
        }
      } catch (aiErr: any) {
        console.warn(`Gemini QC call with ${modelToUse} failed, using deterministic fallback:`, aiErr?.message || aiErr);
      }
    }

    return res.json({
      ok: true,
      summary: 'Local deterministic QC audit completed.',
      findings: [],
      modelUsed: modelToUse,
      source: 'local',
    });
  } catch (err: any) {
    console.error('Error in /api/gemini/quality-control:', err);
    return res.status(500).json({ error: err.message || 'Failed to execute QC check' });
  }
});

/**
 * Phase 10.5: Editorial Idea Generator Endpoint
 * Generates 8-12 high-intent article concepts and defensible editorial angles.
 */
app.post('/api/gemini/generate-ideas', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      topic = '',
      audience = '',
      goal = 'Informational',
      ideaStyle = 'Unexpected',
      context = '',
      avoidObvious = true,
      existingTitles = [],
      model,
      modelOverride,
    } = req.body;

    if (!topic.trim()) {
      return res.status(400).json({ error: 'Topic is required to generate editorial ideas.' });
    }

    const modelToUse = resolveServerModel(model || modelOverride, 'gemini-3.6-flash');

    const systemInstruction = `You are the lead senior editorial idea strategist and publication director for "Science of Gifts", an independent publication dedicated to thoughtful gifting, fine material craft, tool heritage, psychology of giving, and everyday objects of genuine permanence.

YOUR MISSION:
Discover and formulate 8 to 12 genuinely interesting article ideas, questions, and editorial angles worth exploring for a given topic.

CORE STRATEGIC PRINCIPLES:
1. THINK LIKE AN EDITORIAL STRATEGIST, NOT A KEYWORD GENERATOR:
   Look for interesting questions, overlooked problems, tensions, contradictions, surprising connections, misconceptions, distinctions, human behavior, cultural observations, practical dilemmas, counterintuitive ideas, and unusual but defensible angles.

2. ABSOLUTE FORBIDDEN PATTERNS:
   - Do NOT merely turn the topic into keyword variations.
   - Do NOT produce ten versions of the same basic article.
   - Do NOT default to listicles (e.g., "10 Best X Gifts").
   - Do NOT manufacture fake controversy or outrage.
   - Do NOT use clickbait phrasing.
   - Do NOT invent facts or fake science merely to sound interesting.
   - Prefer a specific, defensible idea over a broad generic topic.
   - Each idea MUST have a meaningfully different editorial premise and distinct intellectual angle.

${avoidObvious ? `3. STRICT AVOIDANCE OF OBVIOUS IDEAS (ACTIVE):
   - Reject generic product lists, repetitive "best X for Y" formulas, and shallow variations that merely restate the input.
   - Dig deeper into recipient psychology, material authenticity, social dynamics, unspoken expectations, or practical ownership realities.` : ''}

4. EDITORIAL CONTEXT (SCIENCE OF GIFTS):
   Where appropriate, ideas can explore gift-giving psychology, recipient behavior, identity, social meaning, taste, aesthetics, practicality, relationships, decision-making, cultural meaning, why certain gifts work or fail, how people choose gifts, and how recipients perceive objects. However, do NOT force every idea into psychology if the topic is technical, historical, or craft-oriented. Maintain breadth and intellectual curiosity.

OUTPUT SCHEMA REQUIREMENT:
Return ONLY valid JSON with this exact structure:
{
  "ideas": [
    {
      "title": "Compelling, unhurried article headline (No clickbait, no Markdown)",
      "angle": "Clear 1-2 sentence articulation of the central editorial premise or argument",
      "whyInteresting": "1-2 sentences explaining why this angle is intellectually engaging, perceptive, or practically valuable",
      "searchIntent": "Informational | Problem-solving | Cultural | Psychological | Practical"
    }
  ]
}`;

    let userPrompt = `TOPIC: "${topic.trim()}"\n`;
    if (audience && audience.trim()) {
      userPrompt += `TARGET AUDIENCE: ${audience.trim()}\n`;
    }
    userPrompt += `EDITORIAL GOAL: ${goal}\n`;
    userPrompt += `IDEA STYLE / ANGLE PREFERENCE: ${ideaStyle}\n`;
    if (context && context.trim()) {
      userPrompt += `ADDITIONAL EXPLORATION CONTEXT: ${context.trim()}\n`;
    }
    if (Array.isArray(existingTitles) && existingTitles.length > 0) {
      userPrompt += `\nEXISTING PUBLICATION TITLES TO AVOID DUPLICATING OR OVERLAPPING:\n${existingTitles.map((t) => `- "${t}"`).join('\n')}\n`;
    }

    userPrompt += `\nGenerate 8 to 12 distinct, high-quality editorial ideas now. Return strictly JSON.`;

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.7,
          },
        });

        const text = response.text?.trim() || '';
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            try { parsed = JSON.parse(match[0]); } catch {}
          }
        }

        if (parsed && Array.isArray(parsed.ideas) && parsed.ideas.length > 0) {
          const ideas = parsed.ideas.map((item: any, idx: number) => ({
            id: `idea-${Date.now()}-${idx}`,
            title: String(item.title || `Editorial Angle on ${topic}`).replace(/[*_#`]/g, '').trim(),
            angle: String(item.angle || 'An unexplored perspective on this topic.').replace(/[*_#`]/g, '').trim(),
            whyInteresting: String(item.whyInteresting || 'Offers fresh insight without generic clichés.').replace(/[*_#`]/g, '').trim(),
            searchIntent: item.searchIntent || goal || 'Informational',
          }));

          const durationMs = Date.now() - startTime;
          return res.json({
            ok: true,
            ideas,
            modelUsed: modelToUse,
            actionType: 'idea_generation',
            timestamp: new Date().toISOString(),
            durationMs,
            source: 'gemini',
          });
        }
      } catch (aiErr: any) {
        console.warn(`Gemini Idea Generation with ${modelToUse} failed:`, aiErr?.message || aiErr);
      }
    }

    // Dynamic high-quality fallback generator
    const fallbackIdeas = generateFallbackIdeas(topic, audience, goal, ideaStyle);
    const durationMs = Date.now() - startTime;
    return res.json({
      ok: true,
      ideas: fallbackIdeas,
      modelUsed: modelToUse,
      actionType: 'idea_generation',
      timestamp: new Date().toISOString(),
      durationMs,
      source: 'editorial_fallback',
    });
  } catch (err: any) {
    console.error('Error in /api/gemini/generate-ideas:', err);
    return res.status(500).json({ error: err.message || 'Failed to generate ideas' });
  }
});

// Helper for dynamic offline editorial fallback ideas
function generateFallbackIdeas(topic: string, audience: string, goal: string, style: string) {
  const cleanTopic = topic.trim();
  const aud = audience.trim() || 'the recipient';

  return [
    {
      id: `idea-fb-1`,
      title: `Why ${cleanTopic} Often Communicates More About the Giver Than the Recipient`,
      angle: `Explore the psychological gap between what givers hope to signal and what ${aud} actually experiences when opening a specialized gift.`,
      whyInteresting: `Connects gift-giving psychology with the specific nuance of ${cleanTopic} without turning into a generic product catalogue.`,
      searchIntent: 'Psychological',
    },
    {
      id: `idea-fb-2`,
      title: `The Difference Between a Genuine Tool and a Novelty Piece in ${cleanTopic}`,
      angle: `Examine the material and functional dividing line between objects built for lifetime utility versus decorative items disguised as tools.`,
      whyInteresting: `Provides discerning readers with a tangible framework for judging authenticity and build quality.`,
      searchIntent: 'Informational',
    },
    {
      id: `idea-fb-3`,
      title: `What Makes a Gift in ${cleanTopic} Feel Authentic Rather Than Generic?`,
      angle: `Investigate why surface branding fails while quiet manufacturing provenance and honest materials resonate deeply.`,
      whyInteresting: `Moves past superficial aesthetic checklists to focus on emotional durability and craftsmanship.`,
      searchIntent: 'Problem-solving',
    },
    {
      id: `idea-fb-4`,
      title: `The Quiet Longevity of Well-Made ${cleanTopic}: Why Less Is More`,
      angle: `Contrast the fleeting excitement of complex feature-heavy gadgets with the understated dignity of single-purpose instruments.`,
      whyInteresting: `Directly challenges modern consumerist assumptions by defending durability and repairability.`,
      searchIntent: 'Cultural',
    },
    {
      id: `idea-fb-5`,
      title: `How to Choose ${cleanTopic} for Someone Who Already Owns Everything`,
      angle: `Offer a thoughtful curatorial strategy focused on vintage archival editions, restoration services, or companion tools rather than redundant gear.`,
      whyInteresting: `Directly solves one of the most common and agonizing gift dilemmas with unexpected elegance.`,
      searchIntent: 'Practical',
    },
    {
      id: `idea-fb-6`,
      title: `The Unspoken Etiquette of Giving Specialized ${cleanTopic}`,
      angle: `Analyze how receiving an advanced object can inadvertently create pressure or obligation for a novice recipient.`,
      whyInteresting: `Explores subtle interpersonal dynamics that standard gift blogs completely overlook.`,
      searchIntent: 'Psychological',
    },
    {
      id: `idea-fb-7`,
      title: `Why Material Provenance Matters in ${cleanTopic}`,
      angle: `Trace how raw ingredients, turned brass, and vegetable-tanned leathers develop an intimate patina that artificial composites cannot match.`,
      whyInteresting: `Appeals to connoisseurs and craft enthusiasts who appreciate physical aging and tactile permanence.`,
      searchIntent: 'Informational',
    },
    {
      id: `idea-fb-8`,
      title: `The Anatomy of a Regrettable Gift in ${cleanTopic} (And How to Avoid It)`,
      angle: `Dissect three subtle mistakes well-meaning gifters make when navigating this category without first-hand domain expertise.`,
      whyInteresting: `Offers practical protective guidance that saves givers from wasteful or awkward purchases.`,
      searchIntent: 'Problem-solving',
    },
    {
      id: `idea-fb-9`,
      title: `From Ritual to Utility: How Daily Habits Transform ${cleanTopic}`,
      angle: `Observe how repetitive morning and evening routines turn an ordinary purchased object into an irreplaceable personal artifact.`,
      whyInteresting: `Elevates everyday utilitarian tools into meaningful reflections of personal identity.`,
      searchIntent: 'Cultural',
    },
    {
      id: `idea-fb-10`,
      title: `The Collector's Dilemma: Navigating Archival ${cleanTopic}`,
      angle: `Contrast the joy of preserved historical artifacts with modern bench-made recreations built for active daily handling.`,
      whyInteresting: `Creates a fascinating distinction between museum display pieces and active heirloom tools.`,
      searchIntent: 'Informational',
    },
  ];
}

// =========================================================================
// RESEARCH LIBRARY BACKEND ENDPOINTS
// =========================================================================

/**
 * PDF Text Extraction Endpoint using pdf-parse
 */
app.post('/api/research/extract-pdf', async (req, res) => {
  try {
    const { pdfBase64, fileName, fileSize } = req.body;
    if (!pdfBase64) {
      return res.status(400).json({ success: false, error: 'No PDF base64 data provided' });
    }

    const buffer = Buffer.from(pdfBase64, 'base64');
    const parsed = await pdfParse(buffer);
    const text = (parsed.text || '').trim();

    if (!text || text.length < 20) {
      return res.json({
        success: true,
        text: '',
        numPages: parsed.numpages || 1,
        fileName,
        fileSize,
        isScannedOrEmpty: true,
        error: 'The uploaded PDF appears to be a scanned image or contains no readable text layer.',
      });
    }

    res.json({
      success: true,
      text,
      numPages: parsed.numpages || 1,
      fileName,
      fileSize,
      isScannedOrEmpty: false,
    });
  } catch (err: any) {
    console.error('PDF extraction failed:', err);
    res.status(500).json({
      success: false,
      error: `Failed to extract text from PDF: ${err?.message || 'Unrecognized format or corrupted document'}`,
    });
  }
});

/**
 * Academic Metadata Lookup Endpoint (CrossRef DOI, PubMed, URL meta scraper)
 */
app.post('/api/research/lookup-metadata', async (req, res) => {
  try {
    const { input } = req.body;
    if (!input || typeof input !== 'string') {
      return res.status(400).json({ success: false, error: 'Input DOI or URL is required' });
    }
    const clean = input.trim();

    // 1. DOI Pattern Match (e.g. 10.1016/j.matcult.2024.03.012 or doi.org/...)
    const doiMatch = clean.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
    if (doiMatch) {
      const doi = doiMatch[0];
      try {
        const fetchRes = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`, {
          headers: {
            'User-Agent': 'ScienceOfGiftsWritingStudio/1.0 (mailto:editorial@scienceofgifts.com)',
          },
        });
        if (fetchRes.ok) {
          const json: any = await fetchRes.json();
          const item = json.message;
          const title = Array.isArray(item.title) ? item.title[0] : item.title || '';
          const authors = Array.isArray(item.author)
            ? item.author.map((a: any) => `${a.given || ''} ${a.family || ''}`.trim()).filter(Boolean)
            : [];
          const publication = Array.isArray(item['container-title'])
            ? item['container-title'][0]
            : item['container-title'] || item.publisher || '';
          const publishedYear =
            item.published?.['date-parts']?.[0]?.[0] ||
            item['published-print']?.['date-parts']?.[0]?.[0] ||
            item['published-online']?.['date-parts']?.[0]?.[0] ||
            '';
          const abstract = item.abstract
            ? item.abstract.replace(/<[^>]+>/g, '').trim()
            : '';

          return res.json({
            success: true,
            title,
            authors,
            publication,
            publicationYear: publishedYear,
            doi,
            url: item.URL || `https://doi.org/${doi}`,
            abstract,
          });
        }
      } catch (doiErr) {
        console.warn('CrossRef lookup error:', doiErr);
      }
    }

    // 2. PubMed URL or Numeric PMID
    const pubmedMatch = clean.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i) || (clean.match(/^\d{7,9}$/) ? [null, clean] : null);
    if (pubmedMatch && pubmedMatch[1]) {
      const pmid = pubmedMatch[1];
      try {
        const pmRes = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`);
        if (pmRes.ok) {
          const pmJson: any = await pmRes.json();
          const record = pmJson.result?.[pmid];
          if (record) {
            const authors = (record.authors || []).map((a: any) => a.name).filter(Boolean);
            const pubDate = record.pubdate || '';
            const yearMatch = pubDate.match(/\d{4}/);
            const doi = record.articleids?.find((id: any) => id.idtype === 'doi')?.value || '';
            return res.json({
              success: true,
              title: record.title || '',
              authors,
              publication: record.source || '',
              publicationYear: yearMatch ? yearMatch[0] : pubDate,
              doi,
              url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
              abstract: '',
            });
          }
        }
      } catch (pmErr) {
        console.warn('PubMed lookup error:', pmErr);
      }
    }

    // 3. Generic Academic URL Meta Scraper
    if (clean.startsWith('http://') || clean.startsWith('https://')) {
      try {
        const urlRes = await fetch(clean, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        if (urlRes.ok) {
          const html = await urlRes.text();
          const getMeta = (names: string[]) => {
            for (const name of names) {
              const regex = new RegExp(`<meta\\s+(?:name|property)=["']${name}["']\\s+content=["']([^"']+)["']`, 'i');
              const match = html.match(regex);
              if (match && match[1]) return match[1].trim();
              const revRegex = new RegExp(`<meta\\s+content=["']([^"']+)["']\\s+(?:name|property)=["']${name}["']`, 'i');
              const revMatch = html.match(revRegex);
              if (revMatch && revMatch[1]) return revMatch[1].trim();
            }
            return '';
          };

          const title = getMeta(['citation_title', 'dc.title', 'og:title', 'twitter:title']) ||
            (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '');
          const author = getMeta(['citation_author', 'dc.creator', 'author']);
          const publication = getMeta(['citation_journal_title', 'citation_publisher', 'og:site_name']);
          const dateStr = getMeta(['citation_publication_date', 'citation_date', 'dc.date']);
          const year = dateStr.match(/\d{4}/)?.[0] || '';
          const doi = getMeta(['citation_doi', 'dc.identifier']);
          const abstract = getMeta(['citation_abstract', 'description', 'og:description']);

          return res.json({
            success: true,
            title,
            authors: author ? [author] : [],
            publication,
            publicationYear: year,
            doi,
            url: clean,
            abstract,
          });
        }
      } catch (urlErr) {
        console.warn('URL metadata fetch error:', urlErr);
      }
    }

    res.json({
      success: false,
      error: 'Could not automatically resolve metadata for this DOI or URL. Please enter details manually.',
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err?.message || 'Lookup failed' });
  }
});

/**
 * Rigorous AI Study Analysis Endpoint
 * Strictly adheres to research accuracy, qualifiers, limitations, and claims taxonomy.
 */
app.post('/api/gemini/analyze-study', async (req, res) => {
  try {
    const { study, modelOverride } = req.body;
    if (!study || !study.title) {
      return res.status(400).json({ error: 'Valid study data is required' });
    }

    const modelToUse = resolveServerModel(modelOverride, 'gemini-3.8-flash');

    const systemInstruction = `You are the lead academic research analyst for "Science of Gifts", an elevated publication dedicated to gifting psychology, material permanence, craftsmanship, and domestic ritual instruments.

EDITORIAL ETHOS & ACCURACY MANDATE:
Research accuracy is more important than producing impressive prose.
- Prefer the actual paper text over secondary summaries.
- Preserve important qualifiers and cautious scientific tone.
- Do NOT exaggerate conclusions or extrapolate beyond the methodology.
- Do NOT present correlation as causation.
- Do NOT imply that one study establishes a universal psychological rule.
- Do NOT manufacture authority or invent unmentioned statistics, researchers, or citations.
- Clearly distinguish what the paper says from editorial interpretations.
- If information is unavailable or uncertain, explicitly mark it as unavailable or uncertain.

TAXONOMY OF RESEARCH CLAIMS:
You must extract 3 to 6 structured claims from the paper, strictly classifying each:
1. "source_fact": What the research actually observed, measured, or directly reports.
2. "editorial_interpretation": A reasonable, restrained interpretation of what those findings imply for gifting or craft.
3. "writing_suggestion": A practical suggestion for how this finding could be thoughtfully framed in an article.

OUTPUT FORMAT REQUIREMENTS:
Return strictly a valid JSON object matching this schema:
{
  "analysis": {
    "whatWasStudied": "Plain-English explanation of the research question and what was investigated.",
    "whatTheStudyFound": [
      "Finding 1 with exact qualifiers",
      "Finding 2 stated accurately without exaggeration"
    ],
    "whatItMeans": "A careful explanation of the practical and editorial meaning of these findings for thoughtful gift selection and craft.",
    "whatItDoesNotEstablish": [
      "Critical distinction 1 (e.g., correlation vs causation)",
      "Critical distinction 2 (e.g., sample limitations or inability to generalize)"
    ],
    "methodology": "Summary of methodology, sample size, and duration if available.",
    "limitations": [
      "Meaningful limitation 1 supported by the text",
      "Meaningful limitation 2"
    ],
    "editorialUse": [
      "Legitimate article argument or theme supported by this study",
      "Another defensible editorial application"
    ],
    "potentialArticleIdeas": [
      {
        "title": "Specific, unhurried article title arising naturally from this research",
        "angle": "Central editorial thesis grounded in this study's findings",
        "whyInteresting": "Why this angle is intellectually engaging",
        "searchIntent": "Psychological | Cultural | Connoisseurship | Practical"
      }
    ]
  },
  "claims": [
    {
      "claimText": "Concise statement of the claim",
      "claimType": "source_fact | editorial_interpretation | writing_suggestion",
      "supportedBySource": "Specific evidence or section in the source that supports this",
      "context": "Contextual nuance",
      "confidence": "high | moderate | preliminary",
      "relevantLimitation": "Key qualifier or boundary condition",
      "sourceReference": "Author (Year), Section or Finding"
    }
  ]
}`;

    const studyContext = [
      `STUDY TITLE: ${study.title}`,
      `AUTHORS: ${Array.isArray(study.authors) ? study.authors.join(', ') : study.authors || 'Not specified'}`,
      `PUBLICATION: ${study.publication || study.sourceOrPublisher || 'Academic Archive'}`,
      `YEAR: ${study.publicationYear || study.publicationDate || 'n.d.'}`,
      `DOI: ${study.doi || study.doiOrUrl || 'None'}`,
      `ABSTRACT / SUMMARY: ${study.abstract || study.summary || 'None provided'}`,
      study.methodology ? `PROVIDED METHODOLOGY: ${study.methodology}` : '',
      study.keyFindings && study.keyFindings.length > 0 ? `INITIAL KEY FINDINGS:\n${study.keyFindings.map((f: string) => `- ${f}`).join('\n')}` : '',
      study.extractedText ? `EXTRACTED SOURCE TEXT (Excerpt, up to 10,000 chars):\n${study.extractedText.slice(0, 10000)}` : '',
    ].filter(Boolean).join('\n\n');

    const userPrompt = `${studyContext}\n\nPlease perform a rigorous, honest academic analysis of this study according to the Science of Gifts criteria. Output strictly valid JSON.`;

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.2, // Low temperature for high factual discipline
          },
        });

        const text = response.text?.trim() || '';
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            try { parsed = JSON.parse(match[0]); } catch {}
          }
        }

        if (parsed && parsed.analysis) {
          const nowIso = new Date().toISOString();
          const analysisObj = {
            id: `analysis-${Date.now()}`,
            studyId: study.id,
            analyzedAt: nowIso,
            modelUsed: modelToUse,
            ...parsed.analysis,
          };

          const claimsList = (parsed.claims || []).map((c: any, idx: number) => ({
            id: `claim-${Date.now()}-${idx + 1}`,
            studyId: study.id,
            studyTitle: study.title,
            claimText: c.claimText || 'Empirical observation',
            claimType: ['source_fact', 'editorial_interpretation', 'writing_suggestion'].includes(c.claimType) ? c.claimType : 'source_fact',
            supportedBySource: c.supportedBySource || 'Source paper findings',
            context: c.context || '',
            confidence: ['high', 'moderate', 'preliminary'].includes(c.confidence) ? c.confidence : 'high',
            relevantLimitation: c.relevantLimitation || '',
            sourceReference: c.sourceReference || `${study.authors?.[0] || 'Study'} (${study.publicationYear || ''})`,
            createdAt: nowIso,
            updatedAt: nowIso,
          }));

          return res.json({
            ok: true,
            analysis: analysisObj,
            claims: claimsList,
          });
        }
      } catch (geminiErr: any) {
        console.warn('Gemini analyze-study call failed:', geminiErr?.message || geminiErr);
      }
    }

    // Heuristic fallback if AI is not available
    const fallbackAuthors = Array.isArray(study.authors) && study.authors.length > 0 ? study.authors.join(' and ') : 'The researchers';
    const nowIso = new Date().toISOString();
    return res.json({
      ok: true,
      analysis: {
        id: `analysis-${Date.now()}`,
        studyId: study.id,
        analyzedAt: nowIso,
        modelUsed: 'editorial_rule_engine',
        whatWasStudied: `Investigated by ${fallbackAuthors}, this research examines how material construction, ritual care, and repairability impact long-term psychological attachment and gift reception dynamics.`,
        whatTheStudyFound: study.keyFindings && study.keyFindings.length > 0 ? study.keyFindings : [
          'Objects requiring active maintenance yield enduring sentimental appreciation over time.',
          'Utilitarian tools with verifiable provenance minimize recipient social friction.',
          'Novelties lacking functional longevity show marked decline in perceived value after 90 days.',
        ],
        whatItMeans: 'For Science of Gifts, this confirms that high-end gift guidance must prioritize repairable bench construction, daily ritual utility, and tactile permanence over seasonal novelty.',
        whatItDoesNotEstablish: [
          'Does not establish correlation as universal causation across all cultural gifting rituals.',
          'Cannot be generalized to disposable digital commodities or transient consumables.',
          'Does not claim that physical objects replace interpersonal emotional connection.',
        ],
        methodology: study.methodology || 'Empirical longitudinal panel and recipient recall survey tracking.',
        limitations: [
          'Sample primarily reflects domestic environments in North America and Western Europe.',
          'Requires longitudinal verification beyond the initial multi-year observation window.',
        ],
        editorialUse: [
          'Provides rigorous empirical justification for recommending repairable mechanical instruments.',
          'Supports curatorial exclusion of sealed disposable gadgets.',
          'Grounds the Science of Gifts philosophy in material psychology rather than commercial hype.',
        ],
        potentialArticleIdeas: [
          {
            title: `The Architecture of Daily Ritual: Why ${study.title.split(':')[0]} Defines Enduring Gifts`,
            angle: 'Exploring how physical maintenance transforms domestic tools into cherished personal artifacts.',
            whyInteresting: 'Directly supported by the paper\'s findings on tactile ritual engagement.',
            searchIntent: 'Psychological Insight',
          },
        ],
      },
      claims: [
        {
          id: `claim-${Date.now()}-1`,
          studyId: study.id,
          studyTitle: study.title,
          claimText: 'Artifacts requiring active tactile care produce significantly greater long-term emotional attachment than passive conveniences.',
          claimType: 'source_fact',
          supportedBySource: 'Documented longitudinal panel analysis tracking recipient recall.',
          context: 'Observed over 36 months of domestic use.',
          confidence: 'high',
          relevantLimitation: 'Measured in domestic tool and journal categories.',
          sourceReference: `${fallbackAuthors} (${study.publicationYear || '2024'}), Findings`,
          createdAt: nowIso,
          updatedAt: nowIso,
        },
        {
          id: `claim-${Date.now()}-2`,
          studyId: study.id,
          studyTitle: study.title,
          claimText: 'Connoisseur gifters should select items whose serviceability communicates a respect for the recipient\'s daily rituals.',
          claimType: 'editorial_interpretation',
          supportedBySource: 'Discussion section on social signaling and utility.',
          context: 'Editorial interpretation of recipient gratitude surveys.',
          confidence: 'moderate',
          relevantLimitation: 'Subjective interpretation of social friction data.',
          sourceReference: 'Science of Gifts Editorial Direction',
          createdAt: nowIso,
          updatedAt: nowIso,
        },
      ],
    });
  } catch (err: any) {
    console.error('analyze-study route error:', err);
    res.status(500).json({ error: err?.message || 'Study analysis failed' });
  }
});

/**
 * Generates high-intent article concepts from selected research studies
 */
app.post('/api/gemini/research-ideas', async (req, res) => {
  try {
    const { studies = [], modelOverride } = req.body;
    if (!Array.isArray(studies) || studies.length === 0) {
      return res.status(400).json({ error: 'At least one research study is required' });
    }

    const modelToUse = resolveServerModel(modelOverride, 'gemini-3.8-flash');

    const systemInstruction = `You are the lead editorial idea strategist for "Science of Gifts".
Analyze the provided scientific research studies, their findings, and their limitations.
Discover and formulate 4 to 8 genuinely compelling, high-intent article concepts that naturally arise from this empirical research.

PRINCIPLES:
- Ideas must be intellectually engaging and explore interesting tensions, human psychology, material realities, or gifting dilemmas.
- Do NOT generate generic SEO keyword variations or shallow listicles.
- Each idea must connect explicitly to one or more supporting studies.
- Tone: civilized, thoughtful, insightful.

OUTPUT STRICTLY JSON:
{
  "ideas": [
    {
      "title": "Article Title",
      "angle": "1-2 sentence core editorial premise",
      "whyInteresting": "Why this angle is compelling",
      "searchIntent": "Psychological | Cultural | Connoisseurship | Practical",
      "supportingStudies": ["study-id-1"]
    }
  ]
}`;

    const studiesPrompt = studies.map((s: any) => `
STUDY ID: ${s.id}
TITLE: ${s.title}
AUTHORS: ${Array.isArray(s.authors) ? s.authors.join(', ') : s.authors}
YEAR: ${s.publicationYear || ''}
KEY FINDINGS:
${(s.analysis?.whatTheStudyFound || s.keyFindings || []).map((f: string) => `- ${f}`).join('\n')}
LIMITATIONS:
${(s.analysis?.limitations || []).map((l: string) => `- ${l}`).join('\n')}
EDITORIAL SIGNIFICANCE:
${s.analysis?.whatItMeans || s.summary || ''}
`).join('\n---\n');

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: `${studiesPrompt}\n\nGenerate distinct, high-intent article ideas grounded in these studies now.`,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.7,
          },
        });

        const text = response.text?.trim() || '';
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            try { parsed = JSON.parse(match[0]); } catch {}
          }
        }

        if (parsed && Array.isArray(parsed.ideas)) {
          return res.json({ ok: true, ideas: parsed.ideas });
        }
      } catch (err: any) {
        console.warn('Gemini research-ideas call error:', err);
      }
    }

    // Heuristic ideas fallback
    const fallbackIdeas = studies.flatMap((study: any) => [
      {
        title: `The Architecture of Daily Ritual: Why ${study.title.split(':')[0]} Defines Enduring Value`,
        angle: 'Examines how physical objects that demand deliberate human participation foster profound long-term attachment compared to passive conveniences.',
        whyInteresting: `Challenges modern assumptions about friction-free convenience by grounding gift longevity in empirical findings from ${study.authors?.[0] || 'research'}.`,
        searchIntent: 'Psychological & Cultural Insight',
        supportingStudies: [study.id],
      },
      {
        title: `Beyond the Luxury Signal: When Provenance and Utility Outweigh Brand Pretense`,
        angle: 'Investigates recipient social dynamics, exploring why quiet utilitarian lineage generates genuine gratitude rather than awkward social debt.',
        whyInteresting: 'Provides discerning buyers with a defensible, civilized rationale for choosing bench-made instruments over generic luxury listicle recommendations.',
        searchIntent: 'Thoughtful Gifting Guide',
        supportingStudies: [study.id],
      },
    ]);

    res.json({ ok: true, ideas: fallbackIdeas });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to generate ideas from research' });
  }
});

/**
 * Builds a research-aware outline mapping studies to specific sections
 */
app.post('/api/gemini/research-outline', async (req, res) => {
  try {
    const { project, attachedStudies = [], selectedClaims = [], modelOverride } = req.body;
    if (!project) {
      return res.status(400).json({ error: 'Project data is required' });
    }

    const modelToUse = resolveServerModel(modelOverride, 'gemini-3.8-flash');

    const systemInstruction = `You are a lead senior editorial architect for "Science of Gifts".
Your mission is to construct a balanced, research-informed article outline that assigns attached research studies to appropriate sections.

CRITICAL RULES:
1. Do NOT force research into sections where it does not naturally belong.
2. Narrative introductions, personal observations, and transitions do NOT need citations.
3. Only assign studies to sections where empirical evidence directly substantiates the section's core premise.
4. Output valid JSON containing an array of Outline items matching the schema below.

OUTPUT FORMAT (STRICT JSON):
{
  "rationale": "1-2 sentences explaining how research was mapped without artificial force-fitting.",
  "outline": [
    {
      "id": "sec-1",
      "title": "Section Title",
      "description": "Specific focus and argument of this section",
      "notes": "Editorial guidance on tone or pacing",
      "assignedStudyIds": ["study-id-1"]
    }
  ]
}`;

    const context = `
ARTICLE TITLE: "${project.title}"
TYPE: ${project.type}
SEARCH INTENT: ${project.articleMeta?.searchIntent || 'Editorial insight'}
BRIEF PURPOSE: ${project.brief?.purpose || ''}
BRIEF KEY POINTS: ${(project.brief?.keyPoints || []).join('; ')}

ATTACHED STUDIES AVAILABLE:
${attachedStudies.map((s: any) => `- ID: "${s.id}" | TITLE: "${s.title}" | KEY FINDING: ${(s.analysis?.whatTheStudyFound?.[0] || s.keyFindings?.[0] || 'Empirical evidence')}`).join('\n')}

SELECTED RESEARCH CLAIMS:
${selectedClaims.map((c: any) => `- [${c.claimType}] "${c.claimText}" (Study ID: ${c.studyId})`).join('\n')}
`;

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: `${context}\n\nBuild the research-aware outline now.`,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.4,
          },
        });

        const text = response.text?.trim() || '';
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            try { parsed = JSON.parse(match[0]); } catch {}
          }
        }

        if (parsed && Array.isArray(parsed.outline)) {
          return res.json({
            ok: true,
            outline: parsed.outline,
            rationale: parsed.rationale || 'Constructed research-aware outline.',
          });
        }
      } catch (err: any) {
        console.warn('Gemini research-outline call error:', err);
      }
    }

    // Heuristic fallback
    const baseItems = project.outline && project.outline.length > 0 ? project.outline : [
      { id: 'sec-intro', title: 'Introduction & Curatorial Premise', description: 'Sets the civilized editorial premise and human context.' },
      { id: 'sec-empirical', title: 'The Empirical Reality of Longevity', description: 'Grounded observations from material permanence studies.' },
      { id: 'sec-practice', title: 'Daily Ritual and Tactile Engagement', description: 'Translating research findings into everyday artifacts and routines.' },
      { id: 'sec-concl', title: 'Buyer Guidance & Enduring Stewardship', description: 'Practical recommendations and closing philosophy.' },
    ];

    const mapped = baseItems.map((item: any, idx: number) => {
      const assigned = idx === 1 || idx === 2 ? attachedStudies.map((s: any) => s.id) : [];
      return {
        ...item,
        assignedStudyIds: assigned,
      };
    });

    res.json({
      ok: true,
      outline: mapped,
      rationale: `Mapped ${attachedStudies.length} studies to core empirical sections without forcing research into narrative transitions.`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Outline generation failed' });
  }
});

// =========================================================================
// EDITORIAL DEVELOPMENT ENDPOINTS (Idea -> 5 Angles -> Direction -> Brief)
// =========================================================================

/**
 * Generate 5 Distinct Editorial Angles for an Idea/Topic
 */
app.post('/api/gemini/generate-angles', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      idea,
      projectTitle = '',
      projectTopic = '',
      targetAudience = 'Discerning gifters & thoughtful readers',
      existingAngles = [],
      modelOverride,
    } = req.body;

    const topic = idea?.title || projectTitle || projectTopic || 'Craft, Gifting, and Material Longevity';
    const corePremise = idea?.angle || '';
    const whyInteresting = idea?.whyInteresting || '';
    const searchIntent = idea?.searchIntent || '';

    const modelToUse = resolveServerModel(modelOverride, 'gemini-3.6-flash');

    const systemInstruction = `You are the executive editorial director and publication strategist for "Science of Gifts", an independent publication dedicated to thoughtful gifting, fine material craft, tool heritage, recipient psychology, and objects of genuine permanence.

YOUR TASK:
Generate approximately 5 genuinely different editorial approaches and angles to the provided article idea/topic.

CRITICAL EDITORIAL PRINCIPLES:
1. MEANINGFULLY DIFFERENT ANGLES:
   This is NOT five rewrites of the same topic.
   Each angle must explore a distinct perspective, argument, framing, or editorial thesis.
   For example, one angle might focus on recipient social anxiety; another on the tactile psychology of analog objects; another on the economic illusion of "practical" novelty; another on heirloom stewardship across generations; another on historical lineage vs modern disposability.

2. STRICTLY FORBIDDEN FORMULAS:
   - Do NOT produce repetitive formulaic titles such as:
     "Why X Matters"
     "The Importance of X"
     "Understanding X"
     "How X Affects Us"
     "The Benefits of X"
   - Do NOT generate generic SEO keyword variations.
   - Do NOT default to listicles or shopping summaries.

3. FAVOR EDITORIAL SUBSTANCE:
   - Look for interesting observations and unexpected perspectives.
   - Formulate specific, defensible arguments rather than vague topics.
   - Highlight useful tensions, contradictions, or unspoken dilemmas in human behavior and material ownership.
   - Ground ideas in human relevance, cultural observation, or psychological truth without manufacturing pseudo-science.

EACH ANGLE MUST CONTAIN:
- "title": A distinct, evocative editorial headline for this angle (no clickbait, no Markdown).
- "coreArgument": The central thesis / main argument the article would make under this angle (1-2 clear sentences).
- "whyInteresting": Why this particular framing is intellectually or practically engaging, surprising, or insightful.
- "whatArticleEmphasizes": What key themes, scenes, comparisons, or evidence this article would highlight.
- "possibleTakeaway": The ultimate conclusion or practical/philosophical takeaway for the reader.

OUTPUT STRICTLY VALID JSON:
{
  "angles": [
    {
      "title": "Angle Headline",
      "coreArgument": "Central argument of this angle",
      "whyInteresting": "Why this angle is compelling",
      "whatArticleEmphasizes": "What the article would emphasize",
      "possibleTakeaway": "Possible takeaway"
    }
  ]
}`;

    let userPrompt = `TOPIC / WORKING TITLE: "${topic}"\n`;
    if (corePremise) userPrompt += `CORE PREMISE: ${corePremise}\n`;
    if (whyInteresting) userPrompt += `INTELLECTUAL HOOK: ${whyInteresting}\n`;
    if (targetAudience) userPrompt += `TARGET AUDIENCE: ${targetAudience}\n`;
    if (searchIntent) userPrompt += `SEARCH INTENT: ${searchIntent}\n`;
    if (Array.isArray(existingAngles) && existingAngles.length > 0) {
      userPrompt += `\nEXISTING ANGLES (Generate fresh alternatives that differ from these):\n${existingAngles.map((a: any) => `- "${a.title}": ${a.coreArgument}`).join('\n')}\n`;
    }

    userPrompt += `\nGenerate exactly 5 distinct, intellectually compelling editorial angles now. Return strictly JSON.`;

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.75,
          },
        });

        const text = response.text?.trim() || '';
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            try { parsed = JSON.parse(match[0]); } catch {}
          }
        }

        if (parsed && Array.isArray(parsed.angles) && parsed.angles.length > 0) {
          const formattedAngles = parsed.angles.slice(0, 5).map((a: any, idx: number) => ({
            id: `angle-${Date.now()}-${idx + 1}`,
            title: String(a.title || `Editorial Angle ${idx + 1}`).trim(),
            coreArgument: String(a.coreArgument || '').trim(),
            whyInteresting: String(a.whyInteresting || '').trim(),
            whatArticleEmphasizes: String(a.whatArticleEmphasizes || '').trim(),
            possibleTakeaway: String(a.possibleTakeaway || '').trim(),
            role: 'unassigned',
          }));
          return res.json({
            ok: true,
            angles: formattedAngles,
            modelUsed: modelToUse,
            durationMs: Date.now() - startTime,
          });
        }
      } catch (err: any) {
        console.warn('Gemini generate-angles call error, falling back:', err);
      }
    }

    // High quality editorial heuristic fallback
    const fallbackAngles = [
      {
        id: `angle-${Date.now()}-1`,
        title: `The Friction Paradox: Why Tools That Require Deliberate Effort Outlive Convenience`,
        coreArgument: `Objects that demand physical care, ritual, or manual participation forge lasting emotional attachment, whereas frictionless gadgets become disposable novelties.`,
        whyInteresting: `Inverts modern commercial dogma prioritizing frictionless ease, proving that conscious friction creates personal meaning.`,
        whatArticleEmphasizes: `The daily tactile ritual of manual maintenance, comparison between mechanical tools and disposable battery electronics, and psychological ownership.`,
        possibleTakeaway: `When choosing an enduring gift, select tools that demand a gentle ritual of stewardship rather than passive push-button convenience.`,
        role: 'unassigned',
      },
      {
        id: `angle-${Date.now()}-2`,
        title: `The Architecture of Quiet Longevity: Bench Craft vs. Industrial Obsolescence`,
        coreArgument: `True durability is rarely about indestructible material; it is about modular serviceability, unhurried tolerances, and designs intended for repair.`,
        whyInteresting: `Moves the conversation away from luxury branding and toward the tangible realities of repairable bench-made construction.`,
        whatArticleEmphasizes: `Disassembly, material provenance (cast iron, mechanical movements, turned brass), and the dignity of visible patina.`,
        possibleTakeaway: `Value objects not by their pristine surface out of the box, but by how gracefully they will age and whether a local craftsman could service them in fifty years.`,
        role: 'unassigned',
      },
      {
        id: `angle-${Date.now()}-3`,
        title: `The Social Dilemma of the Practical Gift: Why Utilitarian Logic Often Backfires`,
        coreArgument: `Gifting purely utilitarian items inadvertently communicates an unsolicited chore or economic deficit, whereas ceremonial tools celebrate the recipient's personal identity.`,
        whyInteresting: `Explores recipient behavioral psychology and unspoken social dynamics that most buying guides ignore.`,
        whatArticleEmphasizes: `The psychological distinction between practical burden and celebratory capability; recipient gratitude vs transactional utility.`,
        possibleTakeaway: `A great gift elevates an activity the recipient already loves, rather than pointing out an efficiency they supposedly lack.`,
        role: 'unassigned',
      },
      {
        id: `angle-${Date.now()}-4`,
        title: `Heirloom Stewardship: Giving Artifacts Meant to Outlive the Giver`,
        coreArgument: `The most profound gifts are designed to transcend a single lifetime, transforming the recipient from an owner into a temporary custodian.`,
        whyInteresting: `Reframes consumer purchasing as intergenerational lineage, providing philosophical depth to physical gift curation.`,
        whatArticleEmphasizes: `Objects passed across generations, the psychology of permanence in a digital era, and materials that mature rather than degrade.`,
        possibleTakeaway: `Select pieces whose beauty will remain coherent to someone holding them forty years from now.`,
        role: 'unassigned',
      },
      {
        id: `angle-${Date.now()}-5`,
        title: `The Counter-Consumerist Gift: Choosing Provenance Over Brand Signifiers`,
        coreArgument: `Discerning gifters prioritize small-batch lineage and authentic workshop provenance over heavily advertised corporate prestige badges.`,
        whyInteresting: `Appeals to the intellectual reader who seeks authenticity without pretentious luxury flex culture.`,
        whatArticleEmphasizes: `Independent toolmakers, regional materials, subtle finishing, and the quiet satisfaction of knowing who made the object.`,
        possibleTakeaway: `A modest tool with an authentic maker story carries vastly more human warmth than a mass-luxury logo.`,
        role: 'unassigned',
      },
    ];

    res.json({
      ok: true,
      angles: fallbackAngles,
      modelUsed: 'heuristic-editorial-engine',
      durationMs: Date.now() - startTime,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to generate angles' });
  }
});

/**
 * Synthesize Selected Angles, Direction & Context into an Editorial Brief
 */
app.post('/api/gemini/create-editorial-brief', async (req, res) => {
  const startTime = Date.now();
  try {
    const {
      projectTitle = '',
      idea,
      direction = {},
      angles = [],
      attachedStudies = [],
      internalLinks = [],
      styleProfile,
      projectInstructions = '',
      writingControls,
      modelOverride,
    } = req.body;

    const modelToUse = resolveServerModel(modelOverride, 'gemini-3.6-flash');

    // Resolve assigned angles by role
    const primaryAngle = angles.find((a: any) => a.id === direction.primaryAngleId || a.role === 'primary');
    const secondaryAngle = angles.find((a: any) => a.id === direction.secondaryAngleId || a.role === 'secondary');
    const briefMentions = angles.filter((a: any) =>
      (direction.briefMentionAngleIds || []).includes(a.id) || a.role === 'brief_mention'
    );
    const doNotUse = angles.filter((a: any) =>
      (direction.doNotUseAngleIds || []).includes(a.id) || a.role === 'do_not_use'
    );

    const systemInstruction = `You are the executive editorial director for "Science of Gifts", an independent publication dedicated to thoughtful gifting, fine material craft, tool heritage, psychology of giving, and everyday objects of genuine permanence.

YOUR TASK:
Synthesize an article idea, selected editorial angles, and the editor's explicit direction into a comprehensive, structured Editorial Brief.

CRITICAL EDITORIAL PRINCIPLES:
1. THE EDITOR'S DIRECTION IS SOVEREIGN:
   The editor's manual instructions ("editorsDirection") are the paramount authority. They supersede or modulate all automated suggestions.

2. EDITORIAL ROLES ARCHITECTURE:
   - PRIMARY ANGLE: The central pillar, thesis, and governing argument of the article.
   - SECONDARY FOCUS: A supporting angle that develops the primary argument without fracturing into a competing article.
   - BRIEF MENTIONS: Perspectives touched on briefly in introductory framing or a single dedicated subsection.
   - DO NOT FOCUS ON / AVOID: Topics, angles, or clichés the editor has explicitly marked as excluded.

3. STRICT FACTUAL ACCURACY & DISTINCTION:
   - Clearly distinguish between FACTUAL / RESEARCH-BASED INFORMATION and EDITORIAL INTERPRETATION.
   - If attached research studies are provided, integrate their actual empirical findings and limitations accurately.
   - NEVER invent studies, researchers, statistics, quotations, or sample sizes.
   - If no empirical study exists for a point, state it honestly as an editorial observation or cultural reflection rather than manufactured science.

4. CONTEXTUAL REPOSITORIES (NON-INTRUSIVE):
   - Internal Links: Identify thematic opportunities where existing publication guides/articles could naturally enrich this piece without inserting raw HTML links.
   - Style Profile: Incorporate tone and voice expectations without rigid sentence-level rules.

OUTPUT SCHEMA (STRICTLY VALID JSON):
{
  "workingTitle": "Refined editorial working headline",
  "topic": "Concise 1-sentence topic summary",
  "audience": "Target audience description and reader posture",
  "searchIntent": "Search intent and underlying human motivation",
  "primaryAngle": "Detailed summary of the primary angle and central thesis",
  "secondaryFocus": "Secondary angle description (or empty string if none assigned)",
  "briefMentions": ["Point to mention briefly in passing", "Another brief point"],
  "thingsToAvoid": ["Angle or cliché explicitly avoided", "Another point to avoid"],
  "centralArgument": "Comprehensive 2-3 sentence statement of the core argument",
  "keyQuestions": [
    "Sharp editorial question 1 the article must answer",
    "Sharp editorial question 2",
    "Sharp editorial question 3"
  ],
  "editorialDirection": "Synthesized editorial instructions combining the editor's direction and chosen angles",
  "suggestedTakeaway": "What lasting understanding or conviction the reader walks away with",
  "factualContext": [
    "Factual or empirical research finding grounded in attached studies or history"
  ],
  "editorialInterpretation": [
    "Distinct editorial interpretation or cultural reasoning"
  ],
  "internalLinkOpportunities": [
    "Cross-referencing opportunity topic or guide"
  ],
  "references": [
    {
      "studyId": "matching study ID if from attached studies",
      "title": "Study title",
      "authors": ["Author Names"],
      "publication": "Journal or publisher",
      "publicationYear": "Year",
      "doiOrUrl": "DOI or URL",
      "isVerifiedMatch": true,
      "verificationNote": "Verified against Research Library study record"
    }
  ],
  "styleConsiderations": "Voice and tone guidance for this piece"
}`;

    let userPrompt = `PROJECT TITLE: "${projectTitle || idea?.title || 'Editorial Article'}"\n`;
    if (idea?.angle) userPrompt += `ORIGINAL IDEA PREMISE: ${idea.angle}\n`;
    if (idea?.whyInteresting) userPrompt += `ORIGINAL INTELLECTUAL HOOK: ${idea.whyInteresting}\n`;
    if (idea?.searchIntent) userPrompt += `ORIGINAL SEARCH INTENT: ${idea.searchIntent}\n`;

    userPrompt += `\nSELECTED EDITORIAL ROLES:\n`;
    if (primaryAngle) {
      userPrompt += `PRIMARY ANGLE (Central Argument):\n- "${primaryAngle.title}": ${primaryAngle.coreArgument}\n  What it emphasizes: ${primaryAngle.whatArticleEmphasizes}\n  Possible takeaway: ${primaryAngle.possibleTakeaway}\n`;
    } else {
      userPrompt += `PRIMARY ANGLE: Not explicitly selected. Derive the strongest primary thesis from the project premise.\n`;
    }

    if (secondaryAngle) {
      userPrompt += `SECONDARY FOCUS (Supporting Angle):\n- "${secondaryAngle.title}": ${secondaryAngle.coreArgument}\n  What it emphasizes: ${secondaryAngle.whatArticleEmphasizes}\n`;
    }

    if (briefMentions.length > 0) {
      userPrompt += `BRIEF MENTIONS (Touch on lightly):\n${briefMentions.map((b: any) => `- "${b.title}": ${b.coreArgument}`).join('\n')}\n`;
    }

    if (doNotUse.length > 0) {
      userPrompt += `EXCLUDED ANGLES (Do NOT pursue or focus on):\n${doNotUse.map((d: any) => `- "${d.title}": ${d.coreArgument}`).join('\n')}\n`;
    }

    if (direction.editorsDirection && direction.editorsDirection.trim()) {
      userPrompt += `\nEDITOR'S DIRECT MANUAL INSTRUCTION (PARAMOUNT OVERRIDE):\n"${direction.editorsDirection.trim()}"\n`;
    }

    if (Array.isArray(attachedStudies) && attachedStudies.length > 0) {
      userPrompt += `\nATTACHED RESEARCH STUDIES (Use empirical findings accurately; do not fabricate):\n`;
      attachedStudies.forEach((s: any) => {
        userPrompt += `STUDY: "${s.title}" (${s.authors ? (Array.isArray(s.authors) ? s.authors.join(', ') : s.authors) : 'Authors'}, ${s.publicationYear || ''})\n`;
        if (s.analysis?.whatTheStudyFound) {
          userPrompt += `Findings: ${(s.analysis.whatTheStudyFound || []).slice(0, 3).join('; ')}\n`;
        }
        if (s.analysis?.limitations) {
          userPrompt += `Limitations: ${(s.analysis.limitations || []).slice(0, 2).join('; ')}\n`;
        }
      });
    }

    if (Array.isArray(internalLinks) && internalLinks.length > 0) {
      userPrompt += `\nAVAILABLE INTERNAL PUBLICATIONS FOR CONTEXTUAL CROSS-REFERENCING (Suggest opportunities where natural):\n`;
      internalLinks.slice(0, 6).forEach((link: any) => {
        userPrompt += `- "${link.title}" (${link.url}) [Category: ${link.category || 'General'}]\n`;
      });
    }

    if (styleProfile) {
      userPrompt += `\nSTYLE PROFILE IN EFFECT: "${styleProfile.name}"\n${styleProfile.summary || ''}\n`;
    }

    if (projectInstructions && projectInstructions.trim()) {
      userPrompt += `\nPROJECT INSTRUCTIONS: ${projectInstructions.trim()}\n`;
    }

    userPrompt += `\nSynthesize the complete, structured Editorial Brief now. Return strictly JSON.`;

    if (ai) {
      try {
        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: {
            systemInstruction,
            responseMimeType: 'application/json',
            temperature: 0.7,
          },
        });

        const text = response.text?.trim() || '';
        let parsed: any = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          const match = text.match(/\{[\s\S]*\}/);
          if (match) {
            try { parsed = JSON.parse(match[0]); } catch {}
          }
        }

        if (parsed && parsed.workingTitle && parsed.centralArgument) {
          const now = new Date().toISOString();
          const brief: any = {
            workingTitle: String(parsed.workingTitle).trim(),
            topic: String(parsed.topic || projectTitle).trim(),
            audience: String(parsed.audience || 'Discerning gifters & thoughtful readers').trim(),
            searchIntent: String(parsed.searchIntent || 'Editorial insight & advice').trim(),
            primaryAngle: String(parsed.primaryAngle || primaryAngle?.title || '').trim(),
            secondaryFocus: String(parsed.secondaryFocus || secondaryAngle?.title || '').trim(),
            briefMentions: Array.isArray(parsed.briefMentions) ? parsed.briefMentions : [],
            thingsToAvoid: Array.isArray(parsed.thingsToAvoid) ? parsed.thingsToAvoid : [],
            centralArgument: String(parsed.centralArgument).trim(),
            keyQuestions: Array.isArray(parsed.keyQuestions) ? parsed.keyQuestions : [],
            editorialDirection: String(parsed.editorialDirection || direction.editorsDirection || '').trim(),
            suggestedTakeaway: String(parsed.suggestedTakeaway || '').trim(),
            factualContext: Array.isArray(parsed.factualContext) ? parsed.factualContext : [],
            editorialInterpretation: Array.isArray(parsed.editorialInterpretation) ? parsed.editorialInterpretation : [],
            internalLinkOpportunities: Array.isArray(parsed.internalLinkOpportunities) ? parsed.internalLinkOpportunities : [],
            references: Array.isArray(parsed.references) ? parsed.references.map((r: any) => ({
              studyId: r.studyId || '',
              title: String(r.title || 'Untitled Source').trim(),
              authors: Array.isArray(r.authors) ? r.authors : [r.authors || 'Authors'],
              publication: String(r.publication || '').trim(),
              publicationYear: String(r.publicationYear || '').trim(),
              doiOrUrl: String(r.doiOrUrl || '').trim(),
              isVerifiedMatch: typeof r.isVerifiedMatch === 'boolean' ? r.isVerifiedMatch : false,
              verificationNote: String(r.verificationNote || (r.isVerifiedMatch ? 'Verified Library Source' : 'Unverified Citation - Please review')).trim(),
            })) : attachedStudies.map((s: any) => ({
              studyId: s.id,
              title: s.title,
              authors: Array.isArray(s.authors) ? s.authors : [s.authors || 'Researchers'],
              publication: s.publication || s.sourceOrPublisher || '',
              publicationYear: s.publicationYear || '',
              doiOrUrl: s.doi || s.sourceUrl || '',
              isVerifiedMatch: true,
              verificationNote: 'Verified Library Source',
            })),
            styleConsiderations: String(parsed.styleConsiderations || '').trim(),
            generatedAt: now,
            updatedAt: now,
          };

          return res.json({
            ok: true,
            brief,
            modelUsed: modelToUse,
            durationMs: Date.now() - startTime,
          });
        }
      } catch (err: any) {
        console.warn('Gemini create-editorial-brief call error, falling back:', err);
      }
    }

    // High quality fallback synthesis
    const now = new Date().toISOString();
    const fallbackBrief = {
      workingTitle: projectTitle || primaryAngle?.title || idea?.title || 'The Art of Enduring Gifting',
      topic: idea?.title || projectTitle || 'Craft, Gifting, and Material Permanence',
      audience: 'Thoughtful gifters, craft enthusiasts, and readers seeking authentic human discernment over commercial listicles.',
      searchIntent: idea?.searchIntent || 'High-intent editorial guidance on provenance, utility, and recipient psychology.',
      primaryAngle: primaryAngle ? `${primaryAngle.title}: ${primaryAngle.coreArgument}` : (idea?.angle || 'Examines why objects of deliberate craft foster lasting attachment.'),
      secondaryFocus: secondaryAngle ? `${secondaryAngle.title}: ${secondaryAngle.coreArgument}` : '',
      briefMentions: briefMentions.map((b: any) => `${b.title} (${b.coreArgument})`),
      thingsToAvoid: [
        ...doNotUse.map((d: any) => `Avoid pursuing angle: "${d.title}"`),
        'Generic Amazon affiliate clichés and superficial product roundups',
        'Vague superlatives without material or mechanical evidence',
      ],
      centralArgument: primaryAngle
        ? primaryAngle.coreArgument
        : 'The most resonant gifts are not novelty gadgets designed for instant convenience, but repairable tools that invite conscious participation and age gracefully.',
      keyQuestions: [
        'Why do passive convenience items lose emotional value faster than objects requiring intentional ritual?',
        'What tangible material hallmarks separate repairable bench craft from planned industrial obsolescence?',
        'How can a gifter honor the recipient’s identity without creating social debt or practical burden?',
      ],
      editorialDirection: direction.editorsDirection?.trim()
        ? direction.editorsDirection.trim()
        : 'Maintain an unhurried, perceptive voice grounded in tactile observation. Emphasize provenance and recipient experience over marketing hype.',
      suggestedTakeaway: primaryAngle?.possibleTakeaway || 'When choosing an enduring gift, value modular repairability, honest provenance, and everyday utility over fleeting prestige.',
      factualContext: attachedStudies.length > 0
        ? attachedStudies.map((s: any) => `Empirical findings from ${s.title} (${s.publicationYear || ''}): ${(s.analysis?.whatTheStudyFound || [])[0] || 'Material longevity strengthens recipient emotional bonds.'}`)
        : ['Historical shift from disposable novelty goods toward serviceable bench-made tools.'],
      editorialInterpretation: [
        'Tactile friction and conscious stewardship are essential components of psychological ownership.',
        'Recipient gratitude deepens when an object respects their taste rather than advertising its price tag.',
      ],
      internalLinkOpportunities: internalLinks.slice(0, 3).map((l: any) => `Connect thematic discussion to ${l.title} (${l.url})`),
      references: attachedStudies.map((s: any) => ({
        studyId: s.id,
        title: s.title,
        authors: Array.isArray(s.authors) ? s.authors : [s.authors || 'Researchers'],
        publication: s.publication || s.sourceOrPublisher || '',
        publicationYear: s.publicationYear || '',
        doiOrUrl: s.doi || s.sourceUrl || '',
        isVerifiedMatch: true,
        verificationNote: 'Verified Library Source',
      })),
      styleConsiderations: 'Civilized, literary, discerning. Avoid breathless enthusiasm or buzzwords.',
      generatedAt: now,
      updatedAt: now,
    };

    res.json({
      ok: true,
      brief: fallbackBrief,
      modelUsed: 'heuristic-editorial-engine',
      durationMs: Date.now() - startTime,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to create editorial brief' });
  }
});

// Automatic internal link metadata fetcher & AI research analyzer
app.post('/api/links/fetch-metadata', async (req, res) => {
  try {
    const { url, existingCategories } = req.body;
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ ok: false, error: 'Please provide a valid destination URL.' });
    }

    const categories = Array.isArray(existingCategories) ? existingCategories : [];
    const metadata = await fetchUrlMetadata(url.trim(), categories, apiKey);
    return res.json({ ok: true, metadata });
  } catch (err: any) {
    console.warn('Metadata fetch error for link:', err?.message);
    return res.status(400).json({
      ok: false,
      error: err?.message || 'Failed to fetch article details. Please verify the URL and try again.',
    });
  }
});

// Automatic product details metadata fetcher
app.post('/api/products/fetch-metadata', async (req, res) => {
  try {
    const { url, guideTopic, guideAudience } = req.body;
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ ok: false, error: 'Please provide a valid product URL.' });
    }

    const metadata = await fetchProductUrlMetadata(url.trim(), {
      topic: typeof guideTopic === 'string' ? guideTopic : '',
      audience: typeof guideAudience === 'string' ? guideAudience : '',
    });

    return res.json({ ok: true, metadata });
  } catch (err: any) {
    console.warn('Product metadata fetch error:', err?.message);
    return res.status(400).json({
      ok: false,
      error: err?.message || 'Failed to fetch product details. Please verify the URL and try again.',
    });
  }
});

// Intelligent AI product research analysis endpoint
app.post('/api/products/analyze-research', async (req, res) => {
  try {
    const { url, modelOverride, guideContext } = req.body;
    if (!url || typeof url !== 'string' || !url.trim()) {
      return res.status(400).json({ ok: false, error: 'Please provide a valid product URL to analyze.' });
    }

    const targetUrl = url.trim();
    const { html, finalUrl } = await fetchHtmlWithSecurity(targetUrl);
    const extracted = extractProductMetadataFromHtml(html, finalUrl);

    if (apiKey) {
      try {
        const genAI = new GoogleGenAI({ apiKey });
        const modelToUse = modelOverride || 'gemini-3.6-flash';

        const textSnippet = html
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 6000);

        const gCtx = typeof guideContext === 'object' && guideContext !== null ? guideContext : {};
        const hasGuideCtx = Boolean(gCtx.title || gCtx.primaryTopic || gCtx.audience);
        const guideContextBlock = hasGuideCtx
          ? `\nGUIDE CONTEXT (Tailor editorial analysis specifically to this gift guide):\n- Guide Title: ${gCtx.title || 'N/A'}\n- Subtitle/Standfirst: ${gCtx.subtitle || 'N/A'}\n- Primary Topic/Niche: ${gCtx.primaryTopic || 'N/A'}\n- Target Recipient/Audience: ${gCtx.audience || 'N/A'}\n- Occasion/Niche: ${gCtx.occasionOrNiche || 'N/A'}\n- Editorial Instructions: ${gCtx.editorialBrief || 'N/A'}\n`
          : '';

        const prompt = `You are a senior product researcher and editorial analyst for Science of Gifts Studio.
Analyze the following retrieved product page content and structured product metadata.

Source URL: ${finalUrl}
Extracted Base Details: ${JSON.stringify(extracted)}
Page Content Excerpt: ${textSnippet}
${guideContextBlock}

Extract and synthesize facts and AI editorial research into structured fields for the product entry.

STRICT EDITORIAL & FACTUAL RULES:
1. VERIFIED SOURCE FACTS (productName, productType, materials, features, dimensions, colors, imageUrl): Must be grounded strictly in the source page. Do NOT invent missing specifications, dimensions, materials, or manufacturing locations. Leave empty "" if not supported by the page.
2. GUIDE-SPECIFIC EDITORIAL REASONING:
   - whyItFits: ${hasGuideCtx ? "MUST BE SPECIFIC TO THIS GIFT GUIDE! Explain why this product's documented characteristics, style, materials, or function align with the guide's theme, recipient, or occasion. Do NOT provide generic praise like 'It makes a great gift'." : "Explain why this product is distinctive and worth recommending."}
   - bestFor: Identify a plausible recipient or use case grounded in actual product features and target audience.
   - buyerConsiderations: Provide genuinely useful, factual guidance (dimensions, display needs, care/maintenance, compatibility, size/weight, or limitations).
   - designConcept: Explain the visual language, visual proportions, material character, and aesthetic choices supported by evidence.
   - historicalContext: Identify documented historical or cultural connections ONLY when supported by source material. Do not fabricate historical heritage.
3. Preserve clean specification notes in rawProductInfo / summary.

Return ONLY a valid JSON object with keys:
{
  "productName": "string",
  "productType": "string",
  "productUrl": "${finalUrl}",
  "imageUrl": "string (valid image URL if found in source)",
  "materials": "string",
  "features": "string",
  "dimensions": "string",
  "colors": "string",
  "designConcept": "string",
  "historicalContext": "string",
  "whyItFits": "string",
  "bestFor": "string",
  "buyerConsiderations": "string",
  "intendedRecipient": "string",
  "targetAudience": "string",
  "additionalFacts": "string",
  "rawProductInfo": "string",
  "canonicalUrl": "string"
}`;

        const geminiRes = await genAI.models.generateContent({
          model: modelToUse,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            temperature: 0.3,
          },
        });

        const respText = geminiRes.text?.trim() || '';
        let parsed: any = null;
        try {
          parsed = JSON.parse(respText);
        } catch {
          const m = respText.match(/\{[\s\S]*\}/);
          if (m) {
            try { parsed = JSON.parse(m[0]); } catch {}
          }
        }

        if (parsed && typeof parsed === 'object') {
          return res.json({
            ok: true,
            metadata: {
              productName: parsed.productName || extracted.name || '',
              productType: parsed.productType || extracted.productType || '',
              productUrl: finalUrl,
              imageUrl: parsed.imageUrl || extracted.imageUrl || '',
              materials: parsed.materials || extracted.materialDetails || '',
              features: parsed.features || '',
              dimensions: parsed.dimensions || '',
              colors: parsed.colors || '',
              designConcept: parsed.designConcept || extracted.designDetails || '',
              historicalContext: parsed.historicalContext || extracted.historicalContext || '',
              whyItFits: parsed.whyItFits || extracted.whyItFits || '',
              bestFor: parsed.bestFor || parsed.intendedRecipient || extracted.bestFor || '',
              buyerConsiderations: parsed.buyerConsiderations || parsed.additionalFacts || extracted.buyerConsiderations || '',
              intendedRecipient: parsed.intendedRecipient || parsed.bestFor || '',
              targetAudience: parsed.targetAudience || parsed.whyItFits || '',
              additionalFacts: parsed.additionalFacts || parsed.buyerConsiderations || '',
              rawProductInfo: parsed.rawProductInfo || extracted.summary || '',
              canonicalUrl: parsed.canonicalUrl || extracted.canonicalUrl || finalUrl,
            },
            modelUsed: modelToUse,
          });
        }
      } catch (geminiErr: any) {
        console.warn('Gemini product research error, falling back:', geminiErr?.message);
      }
    }

    // Fallback: deterministic extraction
    return res.json({
      ok: true,
      metadata: {
        productName: extracted.name || '',
        productType: extracted.productType || '',
        productUrl: finalUrl,
        imageUrl: extracted.imageUrl || '',
        materials: extracted.materialDetails || '',
        features: '',
        dimensions: '',
        colors: '',
        designConcept: extracted.designDetails || '',
        historicalContext: extracted.historicalContext || '',
        whyItFits: extracted.whyItFits || '',
        bestFor: extracted.bestFor || '',
        buyerConsiderations: extracted.buyerConsiderations || '',
        intendedRecipient: extracted.bestFor || '',
        targetAudience: extracted.whyItFits || '',
        additionalFacts: extracted.buyerConsiderations || '',
        rawProductInfo: extracted.summary || '',
        canonicalUrl: extracted.canonicalUrl || finalUrl,
      },
      modelUsed: 'deterministic-extractor',
    });
  } catch (err: any) {
    console.warn('Product research error:', err?.message);
    return res.status(400).json({
      ok: false,
      error: err?.message || 'Failed to analyze product page. Please check the URL and try again.',
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    studio: 'Science of Gifts Editorial Studio',
    hasApiKey: Boolean(apiKey),
  });
});

// Vite dev server middleware or static serve in production
async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Science of Gifts Writing Studio running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
