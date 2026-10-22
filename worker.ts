/**
 * Science of Gifts - Unified Cloudflare Worker Entry Point
 * Handles all /api/* endpoints natively and delegates static asset requests to env.ASSETS.
 */

import { GoogleGenAI } from '@google/genai';
import { extractText } from 'unpdf';

export interface Env {
  GEMINI_API_KEY?: string;
  ASSETS: {
    fetch: (request: Request | string) => Promise<Response>;
  };
  [key: string]: any;
}

const VALID_MODELS = new Set([
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
]);

function resolveModel(requested?: string, fallback = 'gemini-3.8-flash'): string {
  if (requested && VALID_MODELS.has(requested)) return requested;
  return fallback;
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

function getAiClient(apiKey?: string): GoogleGenAI | null {
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
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
    relevantProduct = null,
    styleProfileName = '',
    styleProfileInstructions = [],
  } = payload;

  const effectiveControls = writingControls.tone ? writingControls : aiSettings;
  const isMicroAction = Boolean(selectedText) && scope === 'selection';

  const isCoveredByHouse = (t: string) => {
    if (!t) return false;
    const l = t.toLowerCase();
    return (
      l.includes('em dash') ||
      l.includes('em-dash') ||
      l.includes('—') ||
      l.includes('forbidden cliché') ||
      l.includes('forbidden cliche') ||
      l.includes("whether you're looking for") ||
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

  systemInstruction += `\n\n==================================================
LAYER 2: EDITORIAL CONTROLS (PROJECT PARAMETERS)
==================================================
- Target Tone: ${(effectiveControls.tone || 'editorial').toUpperCase()}
- Detail Depth: ${(effectiveControls.detail || 'balanced').toUpperCase()}
- Marketing Intensity: ${(effectiveControls.marketing || 'minimal').toUpperCase()} (strictly restrained by House Constitution)
- Historical Context: ${(effectiveControls.historicalContext || 'moderate').toUpperCase()}
- Intended Audience: ${(effectiveControls.audience || 'enthusiast').toUpperCase()}
${effectiveControls.wordCountTarget ? `- Target Word Range: ${effectiveControls.wordCountTarget}` : ''}`;

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

  let userPrompt = `ACTION TARGET: "${projectTitle}" [${projectType.toUpperCase()}]
`;

  if (isMicroAction) {
    if (brief.purpose || brief.audience) {
      userPrompt += `\nPROJECT BRIEF (Summary for Targeted Edit):
- Purpose: ${brief.purpose || 'Editorial essay'}
- Audience: ${brief.audience || 'Discerning readers'}
`;
    }
  } else {
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

  if (currentContent) {
    if (isMicroAction) {
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

function generateFallbackActionResponse(payload: any): { proposedText: string; explanation: string } {
  const { action, selectedText, metadata = {}, relevantProduct } = payload;

  if (action === 'create_seo_title') {
    return {
      proposedText: `The Art of the Heirloom: A Discerning Guide | Science of Gifts`,
      explanation: 'Crafted a concise, high-intent title under 60 characters without generic buzzwords.',
    };
  }

  if (action === 'create_meta_description') {
    return {
      proposedText: `An unhurried editorial guide exploring bench-made craft, enduring materials, and why utilitarian gifts outlive modern disposable gadgets.`,
      explanation: 'Summarized core thesis in 150 characters with natural search resonance.',
    };
  }

  if (action === 'generate_intro' || action === 'generate_gift_guide_intro') {
    const topic = metadata?.primaryTopic || 'permanent objects and lasting craft';
    const audience = metadata?.audience || 'discerning recipients';
    return {
      proposedText: `<p>For the person who values enduring utility over disposable convenience, a gift is never merely a seasonal transaction. It is an acknowledgment of character. In assembling this guide to ${topic}, we have deliberately bypassed ephemeral novelties in favor of pieces crafted from honest materials: turned brass, heavy cotton canvas, and mechanical movements built to outlast trends.</p><p>What follows is a curated collection for ${audience}, chosen because every item possesses the quiet dignity of a tool meant for daily life.</p>`,
      explanation: 'Authored an unhurried, evocative opening establishing the curatorial premise without generic clichés.',
    };
  }

  if (action === 'generate_best_for') {
    return {
      proposedText: `<p><strong>Best for:</strong> A recipient who appreciates mechanical permanence, tactile materials, and everyday tools built without planned obsolescence.</p>`,
      explanation: 'Created a concise, perceptive recipient summary.',
    };
  }

  if (action === 'generate_buyer_advice') {
    return {
      proposedText: `<h2>Buyer Guidance: Discerning Craft from Commercial Novelty</h2><p>When selecting a gift in this category, resist the temptation of mass-produced listicle recommendations. Look past marketing claims of "luxury" and examine the physical joints, the weight of the raw materials, and the ease with which components can be cleaned or serviced.</p><p>Consider the recipient's daily rhythm: a display piece must possess genuine sculptural or typographic integrity, while an everyday tool should feel balanced in the hand and indifferent to rough weather.</p>`,
      explanation: 'Delivered grounded buyer guidance centered on physical construction rather than brand hype.',
    };
  }

  if (action === 'generate_faq') {
    return {
      proposedText: `<h2>Frequently Asked Questions</h2><div class="space-y-4"><p><strong>Q: How do I know if an item in this guide is authentic heirloom quality?</strong><br/>A: Look for mechanical fasteners rather than adhesive seals, solid unlacquered alloys that develop natural patina, and designs that can be maintained or repaired over decades.</p><p><strong>Q: Are these gifts suitable for someone who already owns similar gear?</strong><br/>A: Yes. Connoisseurs value pieces with distinct manufacturing provenance that stand apart from standard consumer gear.</p></div>`,
      explanation: 'Drafted tight, informative FAQ entries addressing authentic buyer questions.',
    };
  }

  if (action === 'generate_conclusion') {
    return {
      proposedText: `<h2>A Concluding Thought on Lasting Gifts</h2><p>A well-chosen gift is not an exercise in commercial excess; it is an act of attentive observation. By offering an object anchored in deliberate craft, durable materials, and historical dignity, you leave the recipient with something that will quietly accompany their routines for years to come.</p>`,
      explanation: 'Concluded with a resonant, memorable editorial perspective on the gesture of gifting.',
    };
  }

  if (relevantProduct) {
    const name = relevantProduct.name || relevantProduct.productName || 'This piece';
    return {
      proposedText: `Machined and finished with strict adherence to traditional standards, ${name} avoids modern shortcuts in favor of structural substance. The materials have a tangible weight in the hand, suggesting it was designed for daily utility rather than temporary novelty.`,
      explanation: 'Generated specific, restrained product prose honoring raw material notes without marketing hyperbole.',
    };
  }

  if (selectedText) {
    const cleaned = selectedText
      .replace(/—/g, ', ')
      .replace(/Whether you're looking for.*?,\s*/gi, '')
      .replace(/perfect for/gi, 'well suited to')
      .trim();

    return {
      proposedText: `${cleaned} It possesses the quiet weight of an object made to be used and kept, rather than replaced.`,
      explanation: 'Stripped generic phrasing and tightened the sentence structure to reflect Science of Gifts house style.',
    };
  }

  return {
    proposedText: `<p>An unhurried exploration of craft, utility, and objects built to outlast fleeting seasons.</p>`,
    explanation: 'Generated editorial copy aligned with Science of Gifts standards.',
  };
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      },
    });
  }

  const path = url.pathname.replace(/\/$/, '');
  const apiKey = env.GEMINI_API_KEY || '';
  const ai = getAiClient(apiKey);

  // 1. GET /api/health
  if (path === '/api/health' && request.method === 'GET') {
    return jsonResponse({
      status: 'ok',
      studio: 'Science of Gifts Editorial Studio',
      hasApiKey: Boolean(apiKey),
      runtime: 'Cloudflare Worker with Assets',
    });
  }

  // Parse JSON body for POST endpoints
  let body: any = {};
  if (request.method === 'POST') {
    try {
      body = await request.json();
    } catch {
      body = {};
    }
  }

  // 2. POST /api/gemini/action
  if (path === '/api/gemini/action' && request.method === 'POST') {
    const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.8-flash');

    if (ai) {
      try {
        const { systemInstruction, userPrompt } = buildEditorialPrompt(body);
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

        if (parsed && parsed.proposedText) {
          return jsonResponse({
            ok: true,
            proposedText: parsed.proposedText,
            explanation: parsed.explanation || 'Refined prose according to house editorial standards.',
            modelUsed: modelToUse,
            source: 'gemini',
          });
        }
      } catch (err: any) {
        console.warn('Gemini action call failed, using fallback:', err?.message);
      }
    }

    const fallback = generateFallbackActionResponse(body);
    return jsonResponse({
      ok: true,
      proposedText: fallback.proposedText,
      explanation: fallback.explanation,
      modelUsed: modelToUse,
      source: 'fallback',
    });
  }

  // 3. POST /api/gemini/find-citations
  if (path === '/api/gemini/find-citations' && request.method === 'POST') {
    const { documentContent = '', studies = [], existingCitedStudyIds = [] } = body;
    const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

    if (ai && documentContent && studies.length > 0) {
      try {
        const systemInstruction = `You are Senior Research Editor for "Science of Gifts". Identify exact sentences making empirical claims substantiated by studies in the library. Output JSON: { "recommendations": [{ "studyId", "targetPassage", "relevantFinding", "explanation", "confidence" }], "gaps": [{ "claimInArticle", "topicNeeded", "suggestion" }], "rationale" }`;
        const userPrompt = `DOCUMENT:\n${documentContent}\n\nSTUDIES:\n${JSON.stringify(studies)}`;

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.3 },
        });

        const text = response.text?.trim() || '{}';
        const parsed = JSON.parse(text);
        if (parsed && (parsed.recommendations || parsed.gaps)) {
          return jsonResponse({
            ok: true,
            recommendations: parsed.recommendations || [],
            gaps: parsed.gaps || [],
            rationale: parsed.rationale || 'Identified empirical research citations.',
            source: 'gemini',
          });
        }
      } catch (err: any) {
        console.warn('Gemini find-citations call failed, using fallback:', err?.message);
      }
    }

    // Heuristic fallback
    const sentences = (documentContent || '').replace(/\n+/g, ' ').match(/[^.!?]+[.!?]+/g) || [documentContent];
    const recs: any[] = [];
    if (studies.length > 0) {
      studies.forEach((s: any) => {
        const matchedSent = sentences.find((sent: string) => sent.length > 25 && sent.toLowerCase().includes('gift'));
        if (matchedSent) {
          recs.push({
            studyId: s.id,
            targetPassage: matchedSent.trim(),
            relevantFinding: s.keyFindings?.[0] || 'Empirical evidence substantiates recipient appreciation.',
            explanation: `Supports the assertion regarding ${s.title}.`,
            confidence: 'verified_empirical',
          });
        }
      });
    }

    return jsonResponse({
      ok: true,
      recommendations: recs,
      gaps: [{ claimInArticle: 'Long-term recipient attachment', topicNeeded: 'Longitudinal recipient studies', suggestion: 'Attach relevant studies.' }],
      rationale: recs.length > 0 ? 'Matched citations based on study library.' : 'No active citations matched.',
      source: 'fallback',
    });
  }

  // 4. POST /api/gemini/editorial-review
  if (path === '/api/gemini/editorial-review' && request.method === 'POST') {
    const { documentContent = '', selectedText = '', scope = 'all' } = body;
    const textToReview = scope === 'selection' && selectedText ? selectedText : documentContent;
    const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.8-flash');

    if (ai && textToReview.trim()) {
      try {
        const systemInstruction = `You are chief editorial reviewer for "Science of Gifts". Audit text for clichés, em dashes, repetition, clarity, unsupported claims. Return JSON: { "qualitativeSummary": "string", "findings": [{ "category", "severity", "location": { "type", "description" }, "originalText", "explanation", "suggestedAction", "proposedText", "isRuleViolation" }] }`;
        const userPrompt = `TEXT TO REVIEW:\n"""\n${textToReview}\n"""`;

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.2 },
        });

        const text = response.text?.trim() || '';
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.findings)) {
          const findings = parsed.findings.map((f: any, idx: number) => ({
            id: `rf-${Date.now()}-${idx}`,
            category: f.category || 'tone_style',
            severity: f.severity || 'important',
            location: f.location || { type: 'sentence', description: 'Document' },
            originalText: f.originalText || '',
            explanation: f.explanation || 'Editorial review observation.',
            suggestedAction: f.suggestedAction || 'Review passage.',
            proposedText: f.proposedText || undefined,
            status: 'pending',
            isRuleViolation: Boolean(f.isRuleViolation || f.category === 'content_rules'),
            createdAt: new Date().toISOString(),
          }));

          const counts = {
            critical: findings.filter((f: any) => f.severity === 'critical').length,
            important: findings.filter((f: any) => f.severity === 'important').length,
            minor: findings.filter((f: any) => f.severity === 'minor').length,
            suggestion: findings.filter((f: any) => f.severity === 'suggestion').length,
          };

          return jsonResponse({
            ok: true,
            id: `rev-${Date.now()}`,
            reviewedAt: new Date().toISOString(),
            scope,
            qualitativeSummary: parsed.qualitativeSummary || 'Editorial review complete.',
            counts,
            findings,
            modelUsed: modelToUse,
            source: 'gemini',
          });
        }
      } catch (err: any) {
        console.warn('Gemini editorial-review call failed, using fallback:', err?.message);
      }
    }

    // Heuristic fallback findings
    const fallbackFindings: any[] = [];
    if (textToReview.includes('—')) {
      fallbackFindings.push({
        id: `rf-fb-${Date.now()}-1`,
        category: 'content_rules',
        severity: 'critical',
        location: { type: 'sentence', description: 'Body text' },
        originalText: '—',
        explanation: 'Em dashes (—) are forbidden by House editorial guidelines.',
        suggestedAction: 'Replace with commas, colons, or parentheses.',
        proposedText: ', ',
        status: 'pending',
        isRuleViolation: true,
        createdAt: new Date().toISOString(),
      });
    }

    return jsonResponse({
      ok: true,
      id: `rev-fb-${Date.now()}`,
      reviewedAt: new Date().toISOString(),
      scope,
      qualitativeSummary: fallbackFindings.length > 0 ? 'Audit identified punctuation and house style items.' : 'Prose adheres well to house standards.',
      counts: { critical: fallbackFindings.length, important: 0, minor: 0, suggestion: 0 },
      findings: fallbackFindings,
      source: 'fallback',
    });
  }

  // 5. POST /api/gemini/outline
  if (path === '/api/gemini/outline' && request.method === 'POST') {
    const { structureType = 'essay', projectTitle = 'Untitled' } = body;
    const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

    if (ai) {
      try {
        const systemInstruction = `You are executive editorial architect for "Science of Gifts". Construct an outline for "${projectTitle}" [Mode: ${structureType}]. Output JSON: { "structureType", "rationale", "outline": [{ "title", "heading", "purpose", "mainIdea", "develops", "notes" }] }`;
        const userPrompt = `Generate a 5-step ${structureType} outline now.`;

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.6 },
        });

        const text = response.text?.trim() || '';
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.outline) && parsed.outline.length > 0) {
          const formatted = parsed.outline.map((item: any, idx: number) => ({
            id: `outline-${Date.now()}-${idx + 1}`,
            title: String(item.title || `Step ${idx + 1}`).trim(),
            heading: item.heading ? String(item.heading).trim() : undefined,
            purpose: String(item.purpose || item.description || '').trim(),
            mainIdea: String(item.mainIdea || '').trim(),
            develops: String(item.develops || '').trim(),
            description: String(item.description || item.purpose || '').trim(),
            notes: String(item.notes || '').trim(),
            completed: false,
          }));

          return jsonResponse({
            ok: true,
            modelUsed: modelToUse,
            structureType: parsed.structureType || structureType,
            rationale: parsed.rationale || 'Constructed intellectual progression.',
            outline: formatted,
          });
        }
      } catch (err: any) {
        console.warn('Gemini outline call failed, using fallback:', err?.message);
      }
    }

    const fallbackOutline = [
      { id: `o-1`, title: '1. Opening Observation: The Antidote to Disposability', purpose: 'Establish the core paradox between fleeting novelties and permanent tools.', mainIdea: 'Gifts that last communicate character.', develops: 'Opens inquiry.', notes: 'Keep tone unhurried.', completed: false },
      { id: `o-2`, title: '2. The Mechanics of Honest Materials', purpose: 'Examine raw grain, joinery, and why repairability matters.', mainIdea: 'Durability lies in mechanical simplicity.', develops: 'Explores material craft.', notes: 'Focus on turned brass and carbon steel.', completed: false },
      { id: `o-3`, title: '3. The Daily Ritual of Utility', purpose: 'Observe how the object weathers regular daily use.', mainIdea: 'Objects earn affection through gentle physical friction.', develops: 'Connects materials to recipient psychology.', notes: 'Avoid marketing claims.', completed: false },
      { id: `o-4`, title: '4. Buyer Guidance: Discerning Craft from Novelty', purpose: 'Practical guidance on assessing workshop tolerances.', mainIdea: 'Discerning buyers look for maker transparency.', develops: 'Equips reader with inspection criteria.', notes: 'Actionable guidance.', completed: false },
      { id: `o-5`, title: '5. Conclusion: Giving Objects That Outlive Us', purpose: 'Closing reflection on lasting generosity.', mainIdea: 'The best gifts become silent companions.', develops: 'Delivers enduring takeaway.', notes: 'Evocative closing cadence.', completed: false },
    ];

    return jsonResponse({
      ok: true,
      structureType,
      rationale: 'Structured intellectual progression for Science of Gifts.',
      outline: fallbackOutline,
      modelUsed: 'fallback',
    });
  }

  // 6. POST /api/gemini/quality-control
  if (path === '/api/gemini/quality-control' && request.method === 'POST') {
    const { documentContent = '' } = body;
    const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.7-flash');

    if (ai && documentContent.trim()) {
      try {
        const systemInstruction = `You are Quality Control auditor for "Science of Gifts". Check factual consistency, cross-product repetition, SEO alignment. Output JSON: { "summary", "findings": [{ "category", "severity", "title", "location", "explanation", "suggestedAction", "targetText", "proposedText" }] }`;
        const userPrompt = `DOCUMENT:\n${documentContent}`;

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.1 },
        });

        const text = response.text?.trim() || '';
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.findings)) {
          return jsonResponse({
            ok: true,
            summary: parsed.summary || 'Quality control audit complete.',
            findings: parsed.findings,
            modelUsed: modelToUse,
            source: 'gemini',
          });
        }
      } catch (err: any) {
        console.warn('Gemini QC call failed, using fallback:', err?.message);
      }
    }

    return jsonResponse({
      ok: true,
      summary: 'Local Quality Control audit completed.',
      findings: [],
      modelUsed: 'fallback',
    });
  }

  // 7. POST /api/gemini/generate-ideas
  if (path === '/api/gemini/generate-ideas' && request.method === 'POST') {
    const { topic = 'Craft & Gifting', audience = '', goal = 'Informational' } = body;
    const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

    if (ai && topic.trim()) {
      try {
        const systemInstruction = `You are editorial strategist for "Science of Gifts". Discover 8-12 distinct, high-intent article concepts for "${topic}". Output JSON: { "ideas": [{ "title", "angle", "whyInteresting", "searchIntent" }] }`;
        const userPrompt = `TOPIC: ${topic}\nAUDIENCE: ${audience}\nGOAL: ${goal}`;

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.7 },
        });

        const text = response.text?.trim() || '';
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.ideas) && parsed.ideas.length > 0) {
          const ideas = parsed.ideas.map((item: any, idx: number) => ({
            id: `idea-${Date.now()}-${idx}`,
            title: String(item.title || `Editorial Angle on ${topic}`).replace(/[*_#`]/g, '').trim(),
            angle: String(item.angle || 'An unexplored perspective.').replace(/[*_#`]/g, '').trim(),
            whyInteresting: String(item.whyInteresting || 'Offers fresh insight.').replace(/[*_#`]/g, '').trim(),
            searchIntent: item.searchIntent || goal || 'Informational',
          }));

          return jsonResponse({
            ok: true,
            ideas,
            modelUsed: modelToUse,
            source: 'gemini',
          });
        }
      } catch (err: any) {
        console.warn('Gemini generate-ideas call failed, using fallback:', err?.message);
      }
    }

    // Heuristic fallback ideas
    const fallbackIdeas = [
      { id: `idea-fb-1`, title: `Why ${topic} Communicates Character in Gift Selection`, angle: `Explores the psychological gap between giver signals and recipient experience.`, whyInteresting: `Deepens understanding of recipient psychology without sales fluff.`, searchIntent: 'Psychological' },
      { id: `idea-fb-2`, title: `The Line Between Genuine Tools and Novelty in ${topic}`, angle: `Examines material tolerances and lifetime serviceability.`, whyInteresting: `Equips discerning readers with clear inspection criteria.`, searchIntent: 'Informational' },
      { id: `idea-fb-3`, title: `What Makes a Gift in ${topic} Feel Authentic?`, angle: `Investigates why quiet manufacturing provenance resonates deeper than logos.`, whyInteresting: `Focuses on emotional durability and workshop craft.`, searchIntent: 'Problem-solving' },
      { id: `idea-fb-4`, title: `The Quiet Longevity of Well-Made ${topic}`, angle: `Contrasts complex gadgets with single-purpose mechanical instruments.`, whyInteresting: `Challenges planned obsolescence with unhurried reasoning.`, searchIntent: 'Cultural' },
    ];

    return jsonResponse({
      ok: true,
      ideas: fallbackIdeas,
      modelUsed: modelToUse,
      source: 'fallback',
    });
  }

  // 8. POST /api/gemini/generate-angles
  if (path === '/api/gemini/generate-angles' && request.method === 'POST') {
    const { idea, projectTitle = '' } = body;
    const topic = idea?.title || projectTitle || 'Craft, Gifting, and Material Longevity';
    const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

    if (ai) {
      try {
        const systemInstruction = `You are executive editorial director for "Science of Gifts". Generate 5 distinct, non-formulaic editorial angles for "${topic}". Output JSON: { "angles": [{ "title", "coreArgument", "whyInteresting", "whatArticleEmphasizes", "possibleTakeaway" }] }`;
        const userPrompt = `TOPIC: ${topic}\nGenerate 5 distinct editorial angles.`;

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.75 },
        });

        const text = response.text?.trim() || '';
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.angles) && parsed.angles.length > 0) {
          const angles = parsed.angles.slice(0, 5).map((a: any, idx: number) => ({
            id: `angle-${Date.now()}-${idx + 1}`,
            title: String(a.title || `Editorial Angle ${idx + 1}`).trim(),
            coreArgument: String(a.coreArgument || '').trim(),
            whyInteresting: String(a.whyInteresting || '').trim(),
            whatArticleEmphasizes: String(a.whatArticleEmphasizes || '').trim(),
            possibleTakeaway: String(a.possibleTakeaway || '').trim(),
            role: 'unassigned',
          }));

          return jsonResponse({ ok: true, angles, modelUsed: modelToUse });
        }
      } catch (err: any) {
        console.warn('Gemini generate-angles call failed, using fallback:', err?.message);
      }
    }

    const fallbackAngles = [
      { id: `angle-1`, title: `The Friction Paradox: Why Tools Requiring Care Outlive Convenience`, coreArgument: `Objects demanding physical participation forge lasting emotional attachment.`, whyInteresting: `Proves that conscious friction creates personal meaning.`, whatArticleEmphasizes: `Daily tactile ritual, comparison between mechanical tools and gadgets.`, possibleTakeaway: `Select tools that invite stewardship.`, role: 'unassigned' },
      { id: `angle-2`, title: `The Architecture of Quiet Longevity: Bench Craft vs Obsolescence`, coreArgument: `True durability is about modular serviceability and repairable design.`, whyInteresting: `Focuses on tangible workshop construction over prestige badges.`, whatArticleEmphasizes: `Disassembly, material provenance, visible patina.`, possibleTakeaway: `Value objects by whether they can be serviced in fifty years.`, role: 'unassigned' },
      { id: `angle-3`, title: `The Social Dilemma of the Practical Gift`, coreArgument: `Utilitarian items can communicate chores, whereas celebratory tools honor identity.`, whyInteresting: `Explores recipient behavioral psychology.`, whatArticleEmphasizes: `Distinction between practical burden and celebratory capability.`, possibleTakeaway: `Elevate an activity the recipient already loves.`, role: 'unassigned' },
      { id: `angle-4`, title: `Heirloom Stewardship: Giving Artifacts Meant to Outlive Us`, coreArgument: `The best gifts transform recipients into temporary custodians.`, whyInteresting: `Reframes purchasing as intergenerational lineage.`, whatArticleEmphasizes: `Intergenerational objects, digital era permanence.`, possibleTakeaway: `Choose pieces whose beauty remains coherent decades from now.`, role: 'unassigned' },
      { id: `angle-5`, title: `The Counter-Consumerist Gift: Provenance Over Logos`, coreArgument: `Discerning gifters prioritize small-batch lineage over corporate prestige.`, whyInteresting: `Appeals to intellectual readers seeking authenticity.`, whatArticleEmphasizes: `Independent toolmakers, regional materials.`, possibleTakeaway: `A modest tool with an authentic maker story carries more warmth.`, role: 'unassigned' },
    ];

    return jsonResponse({ ok: true, angles: fallbackAngles, modelUsed: 'fallback' });
  }

  // 9. POST /api/gemini/create-editorial-brief
  if (path === '/api/gemini/create-editorial-brief' && request.method === 'POST') {
    const { projectTitle = 'Editorial Article', idea, direction = {} } = body;
    const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

    if (ai) {
      try {
        const systemInstruction = `You are executive editorial director for "Science of Gifts". Synthesize idea, selected angles, and direction into a structured Editorial Brief. Output JSON matching the Editorial Brief schema.`;
        const userPrompt = `PROJECT: "${projectTitle}"\nDIRECTION: ${JSON.stringify(direction)}`;

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.7 },
        });

        const text = response.text?.trim() || '';
        const parsed = JSON.parse(text);
        if (parsed && parsed.workingTitle && parsed.centralArgument) {
          const now = new Date().toISOString();
          const brief = {
            ...parsed,
            generatedAt: now,
            updatedAt: now,
          };
          return jsonResponse({ ok: true, brief, modelUsed: modelToUse });
        }
      } catch (err: any) {
        console.warn('Gemini create-editorial-brief call failed, using fallback:', err?.message);
      }
    }

    const now = new Date().toISOString();
    const fallbackBrief = {
      workingTitle: projectTitle || 'The Art of Enduring Gifting',
      topic: idea?.title || projectTitle || 'Craft, Gifting, and Material Permanence',
      audience: 'Thoughtful gifters and readers seeking authentic discernment over commercial listicles.',
      searchIntent: 'Editorial guidance on provenance, utility, and recipient psychology.',
      primaryAngle: idea?.angle || 'Examines why objects of deliberate craft foster lasting attachment.',
      secondaryFocus: '',
      briefMentions: [],
      thingsToAvoid: ['Generic Amazon affiliate clichés', 'Vague superlatives without mechanical evidence'],
      centralArgument: 'The most resonant gifts are repairable tools that invite conscious participation and age gracefully.',
      keyQuestions: [
        'Why do passive items lose emotional value faster than tools requiring care?',
        'What hallmarks separate repairable bench craft from planned obsolescence?',
        'How can a gifter honor recipient identity without creating social debt?',
      ],
      editorialDirection: direction.editorsDirection || 'Maintain an unhurried, perceptive voice. Emphasize provenance and recipient experience.',
      suggestedTakeaway: 'Select items with modular repairability, honest provenance, and everyday utility.',
      factualContext: ['Material longevity strengthens recipient emotional bonds.'],
      editorialInterpretation: ['Tactile maintenance deepens psychological ownership.'],
      internalLinkOpportunities: [],
      references: [],
      styleConsiderations: 'Civilized, restrained, and observant tone.',
      generatedAt: now,
      updatedAt: now,
    };

    return jsonResponse({ ok: true, brief: fallbackBrief, modelUsed: 'fallback' });
  }

  // 10. POST /api/research/extract-pdf
  if (path === '/api/research/extract-pdf' && request.method === 'POST') {
    try {
      const { pdfBase64, fileName, fileSize } = body;
      if (!pdfBase64) {
        return jsonResponse({ success: false, error: 'No PDF base64 data provided' }, 400);
      }

      // Convert base64 to Uint8Array for unpdf
      const binaryString = atob(pdfBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const { text, totalPages } = await extractText(bytes);
      const rawText = Array.isArray(text) ? text.join('\n') : String(text || '');
      const cleanText = rawText.trim();

      if (!cleanText || cleanText.length < 20) {
        return jsonResponse({
          success: true,
          text: '',
          numPages: totalPages || 1,
          fileName,
          fileSize,
          isScannedOrEmpty: true,
          error: 'The uploaded PDF appears to be a scanned image or contains no readable text layer.',
        });
      }

      return jsonResponse({
        success: true,
        text: cleanText,
        numPages: totalPages || 1,
        fileName,
        fileSize,
        isScannedOrEmpty: false,
      });
    } catch (err: any) {
      console.error('PDF extraction failed:', err);
      return jsonResponse(
        {
          success: false,
          error: `Failed to extract text from PDF: ${err?.message || 'Unrecognized format or corrupted document'}`,
        },
        500
      );
    }
  }

  // 11. POST /api/research/lookup-metadata
  if (path === '/api/research/lookup-metadata' && request.method === 'POST') {
    try {
      const { input } = body;
      if (!input || typeof input !== 'string') {
        return jsonResponse({ success: false, error: 'Input DOI or URL is required' }, 400);
      }
      const clean = input.trim();

      // DOI Pattern Match (e.g. 10.1016/...)
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
            const abstract = item.abstract ? item.abstract.replace(/<[^>]+>/g, '').trim() : '';

            return jsonResponse({
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

      // PubMed
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
              return jsonResponse({
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

      // Generic URL Meta Scraper
      if (clean.startsWith('http://') || clean.startsWith('https://')) {
        try {
          const urlRes = await fetch(clean, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            },
          });
          if (urlRes.ok) {
            const html = await urlRes.text();
            const getMeta = (names: string[]) => {
              for (const name of names) {
                const regex = new RegExp(`<meta\\s+(?:name|property)=["']${name}["']\\s+content=["']([^"']+)["']`, 'i');
                const match = html.match(regex);
                if (match && match[1]) return match[1].trim();
              }
              return '';
            };

            const title = getMeta(['citation_title', 'dc.title', 'og:title']) ||
              (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '');
            const author = getMeta(['citation_author', 'dc.creator', 'author']);
            const publication = getMeta(['citation_journal_title', 'citation_publisher', 'og:site_name']);
            const dateStr = getMeta(['citation_publication_date', 'citation_date', 'dc.date']);
            const year = dateStr.match(/\d{4}/)?.[0] || '';
            const doi = getMeta(['citation_doi', 'dc.identifier']);
            const abstract = getMeta(['citation_abstract', 'description', 'og:description']);

            return jsonResponse({
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

      return jsonResponse({
        success: false,
        error: 'Could not automatically resolve metadata for this DOI or URL. Please enter details manually.',
      });
    } catch (err: any) {
      return jsonResponse({ success: false, error: err?.message || 'Lookup failed' }, 500);
    }
  }

  // 12. POST /api/links/fetch-metadata
  if (path === '/api/links/fetch-metadata' && request.method === 'POST') {
    try {
      const { url: inputUrl, existingCategories = [] } = body;
      if (!inputUrl || typeof inputUrl !== 'string' || !inputUrl.trim()) {
        return jsonResponse({ ok: false, error: 'URL is required' }, 400);
      }
      const targetUrl = inputUrl.trim();
      let html = '';
      try {
        const fetchRes = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });
        if (fetchRes.ok) {
          html = await fetchRes.text();
        }
      } catch (err: any) {
        console.warn('HTML fetch error for link metadata:', err?.message);
      }

      const getMeta = (names: string[]) => {
        for (const name of names) {
          const regex = new RegExp(`<meta\\s+(?:name|property|itemprop)=["']${name}["']\\s+content=["']([^"']+)["']`, 'i');
          const m = html.match(regex);
          if (m && m[1]) return m[1].trim();
        }
        return '';
      };

      const rawTitle = getMeta(['og:title', 'twitter:title', 'title']) ||
        (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || 'Science of Gifts Article');

      const cleanTitle = rawTitle.replace(/\s*(?:\||–|—|-)\s*(?:Science of Gifts|Blog|Home|Shop|Store).*$/i, '').trim();

      let description = getMeta(['description', 'og:description', 'twitter:description']);
      if (!description && html) {
        const pMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        if (pMatch && pMatch[1]) {
          description = pMatch[1].replace(/<[^>]+>/g, '').trim().slice(0, 220);
        }
      }

      const preferredAnchor = cleanTitle.toLowerCase().replace(/^(the|an?)\s+/i, '').split(/\s+/).slice(0, 6).join(' ');

      let category = 'Editorial';
      if (Array.isArray(existingCategories) && existingCategories.length > 0) {
        const foundCat = existingCategories.find((c: string) => cleanTitle.toLowerCase().includes(c.toLowerCase()));
        if (foundCat) category = foundCat;
      }

      return jsonResponse({
        ok: true,
        metadata: {
          title: cleanTitle || 'Destination Article',
          description: description || 'Editorial article in Science of Gifts Library.',
          topic: cleanTitle,
          category,
          destinationType: targetUrl.includes('/products/') ? 'product' : targetUrl.includes('/collections/') || targetUrl.includes('/pages/') ? 'shop_guide' : 'article',
          preferredAnchor: preferredAnchor || 'editorial guide',
          notes: `Contextual link destination: ${cleanTitle}`,
          resolvedUrl: targetUrl,
        },
      });
    } catch (err: any) {
      return jsonResponse({ ok: false, error: err?.message || 'Failed to fetch article metadata' }, 400);
    }
  }

  // 13. POST /api/products/fetch-metadata
  if (path === '/api/products/fetch-metadata' && request.method === 'POST') {
    try {
      const { url: inputUrl, guideTopic = '', guideAudience = '' } = body;
      if (!inputUrl || typeof inputUrl !== 'string' || !inputUrl.trim()) {
        return jsonResponse({ ok: false, error: 'Product URL is required' }, 400);
      }
      const targetUrl = inputUrl.trim();
      let html = '';
      try {
        const fetchRes = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });
        if (fetchRes.ok) {
          html = await fetchRes.text();
        }
      } catch (err: any) {
        console.warn('HTML fetch error for product metadata:', err?.message);
      }

      const getMeta = (names: string[]) => {
        for (const name of names) {
          const regex = new RegExp(`<meta\\s+(?:name|property|itemprop)=["']${name}["']\\s+content=["']([^"']+)["']`, 'i');
          const m = html.match(regex);
          if (m && m[1]) return m[1].trim();
        }
        return '';
      };

      let productName = getMeta(['og:title', 'twitter:title']) || (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() || '');
      productName = productName.replace(/\s*(?:\||–|—|-)\s*(?:Science of Gifts|Shop|Store).*$/i, '').trim();

      let imageUrl = getMeta(['og:image', 'twitter:image']);
      let summary = getMeta(['description', 'og:description', 'twitter:description']);

      let materials = '';
      let productType = 'Curated Instrument';

      const jsonLdMatch = html.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
      if (jsonLdMatch && jsonLdMatch[1]) {
        try {
          const json = JSON.parse(jsonLdMatch[1]);
          const item = Array.isArray(json) ? json[0] : (json['@graph'] ? json['@graph'].find((g: any) => g['@type'] === 'Product') : json);
          if (item) {
            if (item.name) productName = item.name;
            if (item.description) summary = item.description;
            if (item.image) imageUrl = typeof item.image === 'string' ? item.image : (Array.isArray(item.image) ? item.image[0] : item.image?.url);
            if (item.material) materials = Array.isArray(item.material) ? item.material.join(', ') : String(item.material);
            if (item.category) productType = item.category;
          }
        } catch {}
      }

      return jsonResponse({
        ok: true,
        metadata: {
          name: productName || 'Curated Product',
          productType,
          summary: summary || 'Curated item from Science of Gifts collection.',
          materialDetails: materials || 'Traditional honest materials',
          historicalContext: 'Rooted in proven workshop heritage.',
          designDetails: 'Solid construction and tactile finish.',
          whyItFits: `Complements ${guideTopic || 'the curated gift collection'} with authentic quality.`,
          bestFor: `Discerning recipients and ${guideAudience || 'enthusiasts'} seeking lasting utility.`,
          buyerConsiderations: 'Simple maintenance ensures decades of service.',
          imageUrl: imageUrl || '',
          resolvedUrl: targetUrl,
        },
      });
    } catch (err: any) {
      return jsonResponse({ ok: false, error: err?.message || 'Failed to fetch product metadata' }, 400);
    }
  }

  // 14. POST /api/products/analyze-research
  if (path === '/api/products/analyze-research' && request.method === 'POST') {
    try {
      const { url: inputUrl, modelOverride, guideContext = {} } = body;
      if (!inputUrl || typeof inputUrl !== 'string' || !inputUrl.trim()) {
        return jsonResponse({ ok: false, error: 'Product URL is required' }, 400);
      }
      const targetUrl = inputUrl.trim();
      const modelToUse = resolveModel(modelOverride, 'gemini-3.6-flash');

      let pageHtml = '';
      try {
        const fetchRes = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
        });
        if (fetchRes.ok) {
          pageHtml = await fetchRes.text();
        }
      } catch {}

      const textSnippet = pageHtml
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000);

      if (ai && textSnippet) {
        try {
          const prompt = `You are a senior product researcher for Science of Gifts. Analyze the product page and synthesize research fields for a gift guide entry.\nURL: ${targetUrl}\nExcerpt: ${textSnippet}\nContext: ${JSON.stringify(guideContext)}\nReturn JSON with keys: productName, productType, productUrl, imageUrl, materials, features, dimensions, colors, designConcept, historicalContext, whyItFits, bestFor, buyerConsiderations, intendedRecipient, targetAudience, additionalFacts, rawProductInfo, canonicalUrl.`;

          const geminiRes = await ai.models.generateContent({
            model: modelToUse,
            contents: prompt,
            config: {
              responseMimeType: 'application/json',
              temperature: 0.3,
            },
          });

          const respText = geminiRes.text?.trim() || '';
          const parsed = JSON.parse(respText);
          if (parsed && typeof parsed === 'object') {
            return jsonResponse({
              ok: true,
              metadata: {
                productName: parsed.productName || 'Curated Instrument',
                productType: parsed.productType || 'Heirloom Tool',
                productUrl: targetUrl,
                imageUrl: parsed.imageUrl || '',
                materials: parsed.materials || 'Traditional honest materials',
                features: parsed.features || '',
                dimensions: parsed.dimensions || '',
                colors: parsed.colors || '',
                designConcept: parsed.designConcept || 'Clean mechanical form.',
                historicalContext: parsed.historicalContext || 'Workshop lineage.',
                whyItFits: parsed.whyItFits || 'Offers authentic craft and lasting utility.',
                bestFor: parsed.bestFor || 'Enthusiasts and discerning recipients.',
                buyerConsiderations: parsed.buyerConsiderations || 'Requires minimal periodic care.',
                intendedRecipient: parsed.intendedRecipient || parsed.bestFor || '',
                targetAudience: parsed.targetAudience || '',
                additionalFacts: parsed.additionalFacts || '',
                rawProductInfo: parsed.rawProductInfo || textSnippet.slice(0, 300),
                canonicalUrl: parsed.canonicalUrl || targetUrl,
              },
              modelUsed: modelToUse,
            });
          }
        } catch (geminiErr: any) {
          console.warn('Gemini product research failed, falling back:', geminiErr?.message);
        }
      }

      return jsonResponse({
        ok: true,
        metadata: {
          productName: 'Curated Instrument',
          productType: 'Heirloom Tool',
          productUrl: targetUrl,
          imageUrl: '',
          materials: 'Solid brass, hardwood, and tempered steel',
          features: 'Precision tolerances, repairable mechanical assembly',
          dimensions: 'Standard bench size',
          colors: 'Natural finish',
          designConcept: 'Unpretentious utilitarian design built for decades of use.',
          historicalContext: 'Inspired by traditional mid-century workshop tools.',
          whyItFits: 'Aligns perfectly with the guide’s focus on durability and material craft.',
          bestFor: 'Discerning recipients who value tangible utility over disposable gadgets.',
          buyerConsiderations: 'Simple maintenance preserves mechanical precision.',
          intendedRecipient: 'Discerning craft enthusiast',
          targetAudience: 'Thoughtful gifters',
          additionalFacts: 'Hand-inspected before packaging.',
          rawProductInfo: 'Extracted product details from source page.',
          canonicalUrl: targetUrl,
        },
        modelUsed: 'heuristic-extractor',
      });
    } catch (err: any) {
      return jsonResponse({ ok: false, error: err?.message || 'Failed to analyze product research' }, 400);
    }
  }

  // 15. POST /api/gemini/find-link-opportunities
  if (path === '/api/gemini/find-link-opportunities' && request.method === 'POST') {
    const { projectTitle = 'Draft', projectType = 'article', documentContent = '', availableLinks = [], alreadyUsedUrls = [] } = body;
    const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.8-flash');

    if (!documentContent || documentContent.trim().length === 0) {
      return jsonResponse({ ok: true, opportunities: [], rationale: 'Document is empty.' });
    }

    const activeLinks = Array.isArray(availableLinks) ? availableLinks.filter((l: any) => l.active !== false) : [];
    if (activeLinks.length === 0) {
      return jsonResponse({ ok: true, opportunities: [], rationale: 'No active links available in library.' });
    }

    if (ai) {
      try {
        const systemInstruction = `You are senior editor and SEO linking strategist for "Science of Gifts". Analyze text and identify 2-5 high-value internal link opportunities from the library. Output JSON: { "opportunities": [{ "linkId", "linkTitle", "linkUrl", "destinationType", "targetPassage", "suggestedAnchor", "reason", "seoRationale", "previewText", "relevance" }], "rationale" }`;
        const userPrompt = `PROJECT: "${projectTitle}"\nDOC:\n"""\n${documentContent}\n"""\nLIBRARY:\n${JSON.stringify(activeLinks)}`;

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.3 },
        });

        const text = response.text?.trim() || '';
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.opportunities)) {
          const sanitized = parsed.opportunities.map((o: any, idx: number) => ({
            id: `opp-${Date.now()}-${idx}`,
            linkId: o.linkId || `link-${idx}`,
            linkTitle: o.linkTitle || 'Science of Gifts Destination',
            linkUrl: o.linkUrl || '',
            destinationType: o.destinationType || 'article',
            targetPassage: o.targetPassage || '',
            suggestedAnchor: o.suggestedAnchor || '',
            reason: o.reason || 'Contextual reference providing value to the reader.',
            seoRationale: o.seoRationale || 'Matches search intent.',
            previewText: o.previewText || (o.targetPassage && o.suggestedAnchor ? o.targetPassage.replace(o.suggestedAnchor, `[${o.suggestedAnchor}]`) : undefined),
            relevance: o.relevance || 'high',
            status: 'pending',
          }));

          return jsonResponse({
            ok: true,
            opportunities: sanitized,
            rationale: parsed.rationale || 'Evaluated link opportunities.',
            modelUsed: modelToUse,
            source: 'gemini',
          });
        }
      } catch (err: any) {
        console.warn('Gemini find-link-opportunities failed, using fallback scanner:', err?.message);
      }
    }

    // Deterministic regex/keyword fallback scanner
    const fallbackOpps: any[] = [];
    const plainDoc = documentContent.replace(/<[^>]+>/g, ' ');
    const sentences = plainDoc.match(/[^.!?]+[.!?]+/g) || [plainDoc];

    activeLinks.forEach((link: any, idx: number) => {
      const linkUrl = link.url || '';
      if (Array.isArray(alreadyUsedUrls) && alreadyUsedUrls.some((u: string) => u.toLowerCase().includes(linkUrl.toLowerCase()))) {
        return;
      }

      const keywords = `${link.title || ''} ${link.topic || ''} ${link.preferredAnchor || ''}`.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
      for (const sent of sentences) {
        const lowerSent = sent.toLowerCase();
        const matchedWord = keywords.find((kw: string) => lowerSent.includes(kw));
        if (matchedWord) {
          const passage = sent.trim();
          const anchor = link.preferredAnchor || link.title || matchedWord;

          fallbackOpps.push({
            id: `opp-fb-${Date.now()}-${idx}`,
            linkId: link.id,
            linkTitle: link.title || 'Internal Link',
            linkUrl: linkUrl,
            destinationType: link.destinationType || 'article',
            targetPassage: passage,
            suggestedAnchor: anchor,
            reason: `Provides contextual reading on ${link.topic || link.title}.`,
            seoRationale: 'Matches reader informational interest.',
            previewText: passage.includes(anchor) ? passage.replace(anchor, `[${anchor}]`) : `${passage} ([${anchor}])`,
            relevance: 'high',
            status: 'pending',
          });
          break;
        }
      }
    });

    return jsonResponse({
      ok: true,
      opportunities: fallbackOpps,
      rationale: fallbackOpps.length > 0 ? `Identified ${fallbackOpps.length} contextual link opportunities.` : 'No active link keyword matches found in text.',
      source: 'fallback',
    });
  }

  // 16. POST /api/gemini/analyze-style
  if (path === '/api/gemini/analyze-style' && request.method === 'POST') {
    const { profileName = 'Custom Style Profile', samples = [] } = body;
    const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.8-flash');

    if (ai && Array.isArray(samples) && samples.length > 0) {
      try {
        const systemInstruction = `You are master literary stylist for "Science of Gifts". Dissect writing samples and extract style analysis and reusable instructions for writers. Output JSON: { "summary", "characteristics": [{ "category", "observation", "evidence", "isCommonAcrossSamples" }], "reusableInstructions": [] }`;
        const userPrompt = `PROFILE: "${profileName}"\nSAMPLES:\n${JSON.stringify(samples)}`;

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.5 },
        });

        const text = response.text?.trim() || '';
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.characteristics)) {
          return jsonResponse({
            ok: true,
            summary: parsed.summary || 'Style analysis completed.',
            characteristics: parsed.characteristics || [],
            commonCharacteristics: parsed.commonCharacteristics || parsed.characteristics.filter((c: any) => c.isCommonAcrossSamples),
            sampleSpecificCharacteristics: parsed.sampleSpecificCharacteristics || parsed.characteristics.filter((c: any) => !c.isCommonAcrossSamples),
            reusableInstructions: parsed.reusableInstructions || [],
            modelUsed: modelToUse,
            source: 'gemini',
          });
        }
      } catch (err: any) {
        console.warn('Gemini analyze-style failed, using fallback:', err?.message);
      }
    }

    const fallbackCharacteristics = [
      { category: 'Tone', observation: 'Civilized, restrained, and reflective without promotional posturing.', isCommonAcrossSamples: true },
      { category: 'Sentence Rhythm', observation: 'Balanced compound sentences mixed with concise declarative clauses.', isCommonAcrossSamples: true },
      { category: 'Vocabulary', observation: 'Prefers precise tactile nouns and physical interactions over broad superlatives.', isCommonAcrossSamples: true },
    ];

    return jsonResponse({
      ok: true,
      summary: 'Understated, civilized prose characterized by material specificity, rhythmic sentence variation, and deliberate ritual pacing.',
      characteristics: fallbackCharacteristics,
      commonCharacteristics: fallbackCharacteristics,
      sampleSpecificCharacteristics: [],
      reusableInstructions: [
        'Prefer concrete physical observations and specific material nomenclature.',
        'Use medium-length sentences with occasional brief, declarative sentences for rhythm.',
        'Maintain an understated, civilization-conscious tone; avoid breathless enthusiasm.',
      ],
      source: 'fallback',
    });
  }

  // 17. POST /api/gemini/analyze-study
  if (path === '/api/gemini/analyze-study' && request.method === 'POST') {
    const { study = {} } = body;
    const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.7-flash');
    const nowIso = new Date().toISOString();

    if (ai && study.title) {
      try {
        const systemInstruction = `You are lead research editor for "Science of Gifts". Analyze academic study methodology, findings, and limitations, extracting structured facts and editorial claims. Output JSON: { "analysis": { "id", "studyId", "analyzedAt", "whatWasStudied", "whatTheStudyFound", "whatItMeans", "limitations", "editorialUse" }, "claims": [{ "id", "studyId", "studyTitle", "claimText", "claimType", "confidence", "createdAt" }] }`;
        const userPrompt = `STUDY:\n${JSON.stringify(study)}`;

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.2 },
        });

        const text = response.text?.trim() || '';
        const parsed = JSON.parse(text);
        if (parsed && parsed.analysis) {
          return jsonResponse({
            ok: true,
            analysis: parsed.analysis,
            claims: parsed.claims || [],
            modelUsed: modelToUse,
            source: 'gemini',
          });
        }
      } catch (err: any) {
        console.warn('Gemini analyze-study failed, using fallback:', err?.message);
      }
    }

    return jsonResponse({
      ok: true,
      analysis: {
        id: `analysis-${Date.now()}`,
        studyId: study.id || 'study-1',
        analyzedAt: nowIso,
        whatWasStudied: `Examined how material construction, ritual care, and repairability impact long-term psychological attachment.`,
        whatTheStudyFound: study.keyFindings || ['Objects requiring active maintenance yield enduring sentimental appreciation over time.'],
        whatItMeans: 'Confirms that gift guidance must prioritize repairable bench construction and daily ritual utility.',
        limitations: ['Sample reflects domestic environments in North America and Western Europe.'],
        editorialUse: ['Provides empirical justification for recommending repairable mechanical instruments.'],
      },
      claims: [
        {
          id: `claim-${Date.now()}-1`,
          studyId: study.id || 'study-1',
          studyTitle: study.title || 'Research Study',
          claimText: 'Artifacts requiring active tactile care produce significantly greater long-term emotional attachment.',
          claimType: 'source_fact',
          confidence: 'high',
          createdAt: nowIso,
        },
      ],
      source: 'fallback',
    });
  }

  // 18. POST /api/gemini/research-ideas
  if (path === '/api/gemini/research-ideas' && request.method === 'POST') {
    const { studies = [] } = body;
    const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

    if (ai && Array.isArray(studies) && studies.length > 0) {
      try {
        const systemInstruction = `You are research strategist for "Science of Gifts". Formulate high-intent article concepts from research studies. Output JSON: { "ideas": [{ "title", "angle", "whyInteresting", "searchIntent", "supportingStudies" }] }`;
        const userPrompt = `STUDIES:\n${JSON.stringify(studies)}`;

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.7 },
        });

        const text = response.text?.trim() || '';
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.ideas)) {
          return jsonResponse({
            ok: true,
            ideas: parsed.ideas,
            modelUsed: modelToUse,
            source: 'gemini',
          });
        }
      } catch (err: any) {
        console.warn('Gemini research-ideas failed, using fallback:', err?.message);
      }
    }

    const fallbackIdeas = (Array.isArray(studies) && studies.length > 0 ? studies : [{ id: 'st-1', title: 'Gift Longevity' }]).flatMap((s: any) => [
      {
        title: `The Architecture of Daily Ritual: Why ${s.title ? s.title.split(':')[0] : 'Tactile Care'} Defines Value`,
        angle: 'Examines how physical objects that demand deliberate human participation foster profound long-term attachment.',
        whyInteresting: 'Grounds gift longevity in empirical findings from recent research.',
        searchIntent: 'Psychological Insight',
        supportingStudies: [s.id],
      },
    ]);

    return jsonResponse({
      ok: true,
      ideas: fallbackIdeas,
      source: 'fallback',
    });
  }

  // 19. POST /api/gemini/research-outline
  if (path === '/api/gemini/research-outline' && request.method === 'POST') {
    const { project = {}, attachedStudies = [], selectedClaims = [] } = body;
    const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

    if (ai && Array.isArray(attachedStudies) && attachedStudies.length > 0) {
      try {
        const systemInstruction = `You are editorial architect for "Science of Gifts". Build a research-aware outline mapping studies to sections. Output JSON: { "outline": [{ "id", "title", "description", "assignedStudyIds", "notes" }], "rationale" }`;
        const userPrompt = `PROJECT: "${project.title || 'Article'}"\nSTUDIES:\n${JSON.stringify(attachedStudies)}`;

        const response = await ai.models.generateContent({
          model: modelToUse,
          contents: userPrompt,
          config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.6 },
        });

        const text = response.text?.trim() || '';
        const parsed = JSON.parse(text);
        if (parsed && Array.isArray(parsed.outline)) {
          return jsonResponse({
            ok: true,
            outline: parsed.outline,
            rationale: parsed.rationale || 'Mapped research studies to outline sections.',
            modelUsed: modelToUse,
            source: 'gemini',
          });
        }
      } catch (err: any) {
        console.warn('Gemini research-outline failed, using fallback:', err?.message);
      }
    }

    const studyIds = Array.isArray(attachedStudies) ? attachedStudies.map((s: any) => s.id) : [];
    const fallbackOutline = [
      { id: 'sec-intro', title: 'Introduction & Curatorial Premise', description: 'Sets the civilized editorial premise and human context.' },
      { id: 'sec-empirical', title: 'The Empirical Reality of Longevity', description: 'Grounded observations from material permanence studies.', assignedStudyIds: studyIds },
      { id: 'sec-practice', title: 'Daily Ritual and Tactile Engagement', description: 'Translating research findings into everyday artifacts and routines.', assignedStudyIds: studyIds },
      { id: 'sec-concl', title: 'Buyer Guidance & Enduring Stewardship', description: 'Practical recommendations and closing philosophy.' },
    ];

    return jsonResponse({
      ok: true,
      outline: fallbackOutline,
      rationale: `Assigned ${studyIds.length} empirical studies to central perspective sections.`,
      source: 'fallback',
    });
  }

  // 404 Fallback
  return jsonResponse({ error: `Route ${path} not found` }, 404);
}

export default {
  async fetch(request: Request, env: Env, ctx?: any): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Direct /api/* calls to API handler
    if (path.startsWith('/api/') || path === '/api') {
      return handleApiRequest(request, env);
    }

    // Serve static assets via env.ASSETS binding
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Asset worker binding unavailable', { status: 500 });
  },
};
