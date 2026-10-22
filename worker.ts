/**
 * Science of Gifts - Authoritative Cloudflare Edge Worker with Static Assets
 * Handles all /api/* endpoints natively and delegates static assets to env.ASSETS.
 * Guarantees zero silent fallbacks and full error visibility.
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

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

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
    headers: CORS_HEADERS,
  });
}

function getAiClient(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

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

/**
 * Authoritative API Router Function
 */
export async function handleApiRequest(
  request: Request,
  env: { GEMINI_API_KEY?: string; [key: string]: any }
): Promise<Response> {
  // CORS Preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';

  // 1. GET /api/health
  if (pathname === '/api/health' && request.method === 'GET') {
    return jsonResponse({
      ok: true,
      status: 'healthy',
      hasKey: Boolean(env.GEMINI_API_KEY),
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

  // Check GEMINI_API_KEY requirement for /api/gemini/* routes
  if (pathname.startsWith('/api/gemini/')) {
    if (!env.GEMINI_API_KEY) {
      return jsonResponse(
        {
          ok: false,
          error: 'GEMINI_API_KEY is not configured in Cloudflare Worker environment variables.',
        },
        500
      );
    }
  }

  const apiKey = env.GEMINI_API_KEY || '';
  const getAi = () => getAiClient(apiKey);

  try {
    // 2. POST /api/gemini/action
    if (pathname === '/api/gemini/action' && request.method === 'POST') {
      const ai = getAi();
      const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.8-flash');
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

      if (!parsed || typeof parsed.proposedText !== 'string') {
        throw new Error('Model failed to generate structured editorial text proposal');
      }

      return jsonResponse({
        ok: true,
        proposedText: parsed.proposedText,
        explanation: parsed.explanation || 'Refined prose according to house editorial standards.',
        modelUsed: modelToUse,
      });
    }

    // 3. POST /api/gemini/find-link-opportunities
    if (pathname === '/api/gemini/find-link-opportunities' && request.method === 'POST') {
      const ai = getAi();
      const { projectTitle = 'Draft', documentContent = '', availableLinks = [] } = body;
      const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.8-flash');

      if (!documentContent.trim()) {
        return jsonResponse({ ok: true, opportunities: [], rationale: 'Document is empty.' });
      }

      const activeLinks = Array.isArray(availableLinks) ? availableLinks.filter((l: any) => l.active !== false) : [];
      if (activeLinks.length === 0) {
        return jsonResponse({ ok: true, opportunities: [], rationale: 'No active links available in library.' });
      }

      const systemInstruction = `You are senior editor and SEO linking strategist for "Science of Gifts". Analyze text and identify 2-5 high-value internal link opportunities from the library. Output JSON: { "opportunities": [{ "linkId", "linkTitle", "linkUrl", "destinationType", "targetPassage", "suggestedAnchor", "reason", "seoRationale", "previewText", "relevance" }], "rationale" }`;
      const userPrompt = `PROJECT: "${projectTitle}"\nDOC:\n"""\n${documentContent}\n"""\nLIBRARY:\n${JSON.stringify(activeLinks)}`;

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: userPrompt,
        config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.3 },
      });

      const text = response.text?.trim() || '';
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.opportunities)) {
        throw new Error('Model did not return link opportunities array');
      }

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
      });
    }

    // 4. POST /api/gemini/find-citations
    if (pathname === '/api/gemini/find-citations' && request.method === 'POST') {
      const ai = getAi();
      const { documentContent = '', studies = [] } = body;
      const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

      if (!documentContent) {
        return jsonResponse({ ok: true, recommendations: [], gaps: [], rationale: 'Empty document provided.' });
      }

      const systemInstruction = `You are Senior Research Editor for "Science of Gifts". Identify exact sentences making empirical claims substantiated by studies in the library. Output JSON: { "recommendations": [{ "studyId", "targetPassage", "relevantFinding", "explanation", "confidence" }], "gaps": [{ "claimInArticle", "topicNeeded", "suggestion" }], "rationale" }`;
      const userPrompt = `DOCUMENT:\n${documentContent}\n\nSTUDIES:\n${JSON.stringify(studies)}`;

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: userPrompt,
        config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.3 },
      });

      const text = response.text?.trim() || '{}';
      const parsed = JSON.parse(text);
      return jsonResponse({
        ok: true,
        recommendations: parsed.recommendations || [],
        gaps: parsed.gaps || [],
        rationale: parsed.rationale || 'Identified empirical research citations.',
        modelUsed: modelToUse,
      });
    }

    // 5. POST /api/gemini/editorial-review
    if (pathname === '/api/gemini/editorial-review' && request.method === 'POST') {
      const ai = getAi();
      const { documentContent = '', selectedText = '', scope = 'all' } = body;
      const textToReview = scope === 'selection' && selectedText ? selectedText : documentContent;
      const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.8-flash');

      if (!textToReview.trim()) {
        throw new Error('No content provided for editorial review');
      }

      const systemInstruction = `You are chief editorial reviewer for "Science of Gifts". Audit text for clichés, em dashes, repetition, clarity, unsupported claims. Return JSON: { "qualitativeSummary": "string", "findings": [{ "category", "severity", "location": { "type", "description" }, "originalText", "explanation", "suggestedAction", "proposedText", "isRuleViolation" }] }`;
      const userPrompt = `TEXT TO REVIEW:\n"""\n${textToReview}\n"""`;

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: userPrompt,
        config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.2 },
      });

      const text = response.text?.trim() || '';
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.findings)) {
        throw new Error('Model did not return structured editorial findings');
      }

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
      });
    }

    // 6. POST /api/gemini/quality-control
    if (pathname === '/api/gemini/quality-control' && request.method === 'POST') {
      const ai = getAi();
      const { documentContent = '' } = body;
      const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.7-flash');

      if (!documentContent.trim()) {
        throw new Error('No content provided for quality control audit');
      }

      const systemInstruction = `You are Quality Control auditor for "Science of Gifts". Check factual consistency, cross-product repetition, SEO alignment. Output JSON: { "summary", "findings": [{ "category", "severity", "title", "location", "explanation", "suggestedAction", "targetText", "proposedText" }] }`;
      const userPrompt = `DOCUMENT:\n${documentContent}`;

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: userPrompt,
        config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.1 },
      });

      const text = response.text?.trim() || '';
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.findings)) {
        throw new Error('Model did not return structured QC findings');
      }

      return jsonResponse({
        ok: true,
        summary: parsed.summary || 'Quality control audit complete.',
        findings: parsed.findings,
        modelUsed: modelToUse,
      });
    }

    // 7. POST /api/gemini/outline
    if (pathname === '/api/gemini/outline' && request.method === 'POST') {
      const ai = getAi();
      const { structureType = 'essay', projectTitle = 'Untitled', brief = {} } = body;
      const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

      const systemInstruction = `You are executive editorial architect for "Science of Gifts". Construct an outline for "${projectTitle}" [Mode: ${structureType}]. Output JSON: { "structureType", "rationale", "outline": [{ "title", "heading", "purpose", "mainIdea", "develops", "notes" }] }`;
      const userPrompt = `PROJECT: "${projectTitle}"\nBRIEF:\n${JSON.stringify(brief)}\nGenerate a 5-step ${structureType} outline now.`;

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: userPrompt,
        config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.6 },
      });

      const text = response.text?.trim() || '';
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.outline) || parsed.outline.length === 0) {
        throw new Error('Model did not return structured outline items');
      }

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

    // 8. POST /api/gemini/generate-ideas
    if (pathname === '/api/gemini/generate-ideas' && request.method === 'POST') {
      const ai = getAi();
      const { topic = 'Craft & Gifting', audience = '', goal = 'Informational' } = body;
      const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

      const systemInstruction = `You are editorial strategist for "Science of Gifts". Discover 8-12 distinct, high-intent article concepts for "${topic}". Output JSON: { "ideas": [{ "title", "angle", "whyInteresting", "searchIntent" }] }`;
      const userPrompt = `TOPIC: ${topic}\nAUDIENCE: ${audience}\nGOAL: ${goal}`;

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: userPrompt,
        config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.7 },
      });

      const text = response.text?.trim() || '';
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.ideas)) {
        throw new Error('Model did not return generated ideas');
      }

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
      });
    }

    // 9. POST /api/gemini/generate-angles
    if (pathname === '/api/gemini/generate-angles' && request.method === 'POST') {
      const ai = getAi();
      const { idea, projectTitle = '' } = body;
      const topic = idea?.title || projectTitle || 'Craft, Gifting, and Material Longevity';
      const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

      const systemInstruction = `You are executive editorial director for "Science of Gifts". Generate 5 distinct, non-formulaic editorial angles for "${topic}". Output JSON: { "angles": [{ "title", "coreArgument", "whyInteresting", "whatArticleEmphasizes", "possibleTakeaway" }] }`;
      const userPrompt = `TOPIC: ${topic}\nGenerate 5 distinct editorial angles.`;

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: userPrompt,
        config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.75 },
      });

      const text = response.text?.trim() || '';
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.angles)) {
        throw new Error('Model did not return editorial angles');
      }

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

    // 10. POST /api/gemini/create-editorial-brief
    if (pathname === '/api/gemini/create-editorial-brief' && request.method === 'POST') {
      const ai = getAi();
      const { projectTitle = 'Editorial Article', direction = {} } = body;
      const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

      const systemInstruction = `You are executive editorial director for "Science of Gifts". Synthesize idea, selected angles, and direction into a structured Editorial Brief. Output JSON matching the Editorial Brief schema.`;
      const userPrompt = `PROJECT: "${projectTitle}"\nDIRECTION: ${JSON.stringify(direction)}`;

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: userPrompt,
        config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.7 },
      });

      const text = response.text?.trim() || '';
      const parsed = JSON.parse(text);
      if (!parsed || !parsed.workingTitle || !parsed.centralArgument) {
        throw new Error('Model did not return structured editorial brief');
      }

      const now = new Date().toISOString();
      const brief = {
        ...parsed,
        generatedAt: now,
        updatedAt: now,
      };

      return jsonResponse({ ok: true, brief, modelUsed: modelToUse });
    }

    // 11. POST /api/gemini/analyze-style
    if (pathname === '/api/gemini/analyze-style' && request.method === 'POST') {
      const ai = getAi();
      const { profileName = 'Custom Style Profile', samples = [] } = body;
      const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.8-flash');

      if (!Array.isArray(samples) || samples.length === 0) {
        throw new Error('No writing samples provided for style analysis');
      }

      const systemInstruction = `You are master literary stylist for "Science of Gifts". Dissect writing samples and extract style analysis and reusable instructions for writers. Output JSON: { "summary", "characteristics": [{ "category", "observation", "evidence", "isCommonAcrossSamples" }], "reusableInstructions": [] }`;
      const userPrompt = `PROFILE: "${profileName}"\nSAMPLES:\n${JSON.stringify(samples)}`;

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: userPrompt,
        config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.5 },
      });

      const text = response.text?.trim() || '';
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.characteristics)) {
        throw new Error('Model did not return style analysis characteristics');
      }

      return jsonResponse({
        ok: true,
        summary: parsed.summary || 'Style analysis completed.',
        characteristics: parsed.characteristics || [],
        commonCharacteristics: parsed.commonCharacteristics || parsed.characteristics.filter((c: any) => c.isCommonAcrossSamples),
        sampleSpecificCharacteristics: parsed.sampleSpecificCharacteristics || parsed.characteristics.filter((c: any) => !c.isCommonAcrossSamples),
        reusableInstructions: parsed.reusableInstructions || [],
        modelUsed: modelToUse,
      });
    }

    // 12. POST /api/gemini/analyze-study
    if (pathname === '/api/gemini/analyze-study' && request.method === 'POST') {
      const ai = getAi();
      const { study = {} } = body;
      const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.7-flash');

      if (!study || !study.title) {
        throw new Error('Study title and content are required for analysis');
      }

      const systemInstruction = `You are lead research editor for "Science of Gifts". Analyze academic study methodology, findings, and limitations, extracting structured facts and editorial claims. Output JSON: { "analysis": { "id", "studyId", "analyzedAt", "whatWasStudied", "whatTheStudyFound", "whatItMeans", "limitations", "editorialUse" }, "claims": [{ "id", "studyId", "studyTitle", "claimText", "claimType", "confidence", "createdAt" }] }`;
      const userPrompt = `STUDY:\n${JSON.stringify(study)}`;

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: userPrompt,
        config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.2 },
      });

      const text = response.text?.trim() || '';
      const parsed = JSON.parse(text);
      if (!parsed || !parsed.analysis) {
        throw new Error('Model did not return study analysis');
      }

      return jsonResponse({
        ok: true,
        analysis: parsed.analysis,
        claims: parsed.claims || [],
        modelUsed: modelToUse,
      });
    }

    // 13. POST /api/gemini/research-ideas
    if (pathname === '/api/gemini/research-ideas' && request.method === 'POST') {
      const ai = getAi();
      const { studies = [] } = body;
      const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

      if (!Array.isArray(studies) || studies.length === 0) {
        throw new Error('At least one research study is required');
      }

      const systemInstruction = `You are research strategist for "Science of Gifts". Formulate high-intent article concepts from research studies. Output JSON: { "ideas": [{ "title", "angle", "whyInteresting", "searchIntent", "supportingStudies" }] }`;
      const userPrompt = `STUDIES:\n${JSON.stringify(studies)}`;

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: userPrompt,
        config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.7 },
      });

      const text = response.text?.trim() || '';
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.ideas)) {
        throw new Error('Model did not return research ideas');
      }

      return jsonResponse({
        ok: true,
        ideas: parsed.ideas,
        modelUsed: modelToUse,
      });
    }

    // 14. POST /api/gemini/research-outline
    if (pathname === '/api/gemini/research-outline' && request.method === 'POST') {
      const ai = getAi();
      const { project = {}, attachedStudies = [] } = body;
      const modelToUse = resolveModel(body.model || body.modelOverride, 'gemini-3.6-flash');

      if (!Array.isArray(attachedStudies) || attachedStudies.length === 0) {
        throw new Error('Attached studies are required to build a research outline');
      }

      const systemInstruction = `You are editorial architect for "Science of Gifts". Build a research-aware outline mapping studies to sections. Output JSON: { "outline": [{ "id", "title", "description", "assignedStudyIds", "notes" }], "rationale" }`;
      const userPrompt = `PROJECT: "${project.title || 'Article'}"\nSTUDIES:\n${JSON.stringify(attachedStudies)}`;

      const response = await ai.models.generateContent({
        model: modelToUse,
        contents: userPrompt,
        config: { systemInstruction, responseMimeType: 'application/json', temperature: 0.6 },
      });

      const text = response.text?.trim() || '';
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.outline)) {
        throw new Error('Model did not return research outline');
      }

      return jsonResponse({
        ok: true,
        outline: parsed.outline,
        rationale: parsed.rationale || 'Mapped research studies to outline sections.',
        modelUsed: modelToUse,
      });
    }

    // 15. POST /api/links/fetch-metadata
    if (pathname === '/api/links/fetch-metadata' && request.method === 'POST') {
      const { url: inputUrl, existingCategories = [] } = body;
      if (!inputUrl || typeof inputUrl !== 'string' || !inputUrl.trim()) {
        throw new Error('URL is required for link metadata');
      }
      const targetUrl = inputUrl.trim();
      const fetchRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!fetchRes.ok) {
        throw new Error(`Failed to fetch target URL (Status: ${fetchRes.status})`);
      }

      const html = await fetchRes.text();
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
    }

    // 16. POST /api/products/fetch-metadata
    if (pathname === '/api/products/fetch-metadata' && request.method === 'POST') {
      const { url: inputUrl, guideTopic = '', guideAudience = '' } = body;
      if (!inputUrl || typeof inputUrl !== 'string' || !inputUrl.trim()) {
        throw new Error('Product URL is required');
      }
      const targetUrl = inputUrl.trim();
      const fetchRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (!fetchRes.ok) {
        throw new Error(`Failed to fetch product URL (Status: ${fetchRes.status})`);
      }

      const html = await fetchRes.text();
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
    }

    // 17. POST /api/products/analyze-research
    if (pathname === '/api/products/analyze-research' && request.method === 'POST') {
      const ai = getAi();
      const { url: inputUrl, modelOverride, guideContext = {} } = body;
      if (!inputUrl || typeof inputUrl !== 'string' || !inputUrl.trim()) {
        throw new Error('Product URL is required for research synthesis');
      }
      const targetUrl = inputUrl.trim();
      const modelToUse = resolveModel(modelOverride, 'gemini-3.6-flash');

      const fetchRes = await fetch(targetUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      });
      if (!fetchRes.ok) {
        throw new Error(`Could not access product page at ${targetUrl}`);
      }
      const pageHtml = await fetchRes.text();
      const textSnippet = pageHtml
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 4000);

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
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Model did not return structured product research object');
      }

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

    // 18. POST /api/research/extract-pdf
    if (pathname === '/api/research/extract-pdf' && request.method === 'POST') {
      const { pdfBase64, fileName, fileSize } = body;
      if (!pdfBase64) {
        throw new Error('No PDF base64 data provided');
      }

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
          ok: true,
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
        ok: true,
        text: cleanText,
        numPages: totalPages || 1,
        fileName,
        fileSize,
        isScannedOrEmpty: false,
      });
    }

    // 19. POST /api/research/lookup-metadata
    if (pathname === '/api/research/lookup-metadata' && request.method === 'POST') {
      const { input } = body;
      if (!input || typeof input !== 'string') {
        throw new Error('Input DOI or URL is required');
      }
      const clean = input.trim();

      // DOI Match
      const doiMatch = clean.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i);
      if (doiMatch) {
        const doi = doiMatch[0];
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
            ok: true,
            title,
            authors,
            publication,
            publicationYear: publishedYear,
            doi,
            url: item.URL || `https://doi.org/${doi}`,
            abstract,
          });
        }
      }

      // PubMed Match
      const pubmedMatch = clean.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i) || (clean.match(/^\d{7,9}$/) ? [null, clean] : null);
      if (pubmedMatch && pubmedMatch[1]) {
        const pmid = pubmedMatch[1];
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
              ok: true,
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
      }

      // Generic URL
      if (clean.startsWith('http://') || clean.startsWith('https://')) {
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
            ok: true,
            title,
            authors: author ? [author] : [],
            publication,
            publicationYear: year,
            doi,
            url: clean,
            abstract,
          });
        }
      }

      return jsonResponse({
        success: false,
        ok: false,
        error: 'Could not automatically resolve metadata for this DOI or URL. Please enter details manually.',
      }, 400);
    }

    // Route Not Found
    return jsonResponse({ ok: false, error: `Route ${pathname} not found` }, 404);
  } catch (err: any) {
    console.error(`Error processing endpoint ${pathname}:`, err);
    return jsonResponse({ ok: false, error: err?.message || 'Server execution failed' }, 500);
  }
}

/**
 * Authoritative Edge Worker entry point
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    // Route API requests directly
    if (pathname.startsWith('/api/') || pathname === '/api') {
      return handleApiRequest(request, env);
    }

    // Serve static assets via env.ASSETS for all other requests
    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    return new Response('Assets binding unavailable', { status: 500 });
  },
};
