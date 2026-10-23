/**
 * Prompt Builders for Science of Gifts Writing Studio API Worker
 */

export function resolveServerModel(requested?: string, fallback = 'gemini-3.8-flash'): string {
  const VALID_MODELS = new Set([
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
  ]);
  if (requested && VALID_MODELS.has(requested)) {
    return requested;
  }
  return fallback;
}

export function buildEditorialPrompt(payload: any): { systemInstruction: string; userPrompt: string } {
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

export function buildOutlinePrompt(payload: any): { systemInstruction: string; userPrompt: string } {
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

AVAILABLE RESEARCH STUDIES (${attachedStudies.length} available):
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
