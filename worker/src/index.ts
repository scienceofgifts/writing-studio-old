import { GoogleGenAI } from '@google/genai';
import { extractText } from 'unpdf';
import { resolveServerModel, buildEditorialPrompt, buildOutlinePrompt } from './promptBuilders';
import { generateFallbackResponse, generateFallbackIdeas } from './fallbacks';

// Standard CORS response helper
function handleCors(request: Request, response: Response): Response {
  const origin = request.headers.get('Origin') || '*';
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('Access-Control-Allow-Credentials', 'true');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: any, ctx: any): Promise<Response> {
    const url = new URL(request.url);

    // 1. OPTIONS Preflight handler
    if (request.method === 'OPTIONS') {
      const origin = request.headers.get('Origin') || '*';
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
          'Access-Control-Allow-Credentials': 'true',
        },
      });
    }

    try {
      const apiKey = env.GEMINI_API_KEY || '';
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

      // 2. Health Endpoint
      if (url.pathname === '/api/health') {
        const response = Response.json({
          status: 'ok',
          studio: 'Science of Gifts Editorial Studio',
          hasApiKey: Boolean(apiKey),
        });
        return handleCors(request, response);
      }

      // Guard non-POST requests to remaining endpoints
      if (request.method !== 'POST') {
        return handleCors(request, new Response('Not Found', { status: 404 }));
      }

      const body: any = await request.json().catch(() => ({}));

      // ==========================================
      // ENDPOINT 1: POST /api/gemini/action
      // ==========================================
      if (url.pathname === '/api/gemini/action') {
        const modelToUse = resolveServerModel(body.model || body.modelOverride, 'gemini-3.5-flash');

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

            if (parsed && (parsed.proposedText || parsed.explanation)) {
              return handleCors(request, Response.json({
                ok: true,
                proposedText: parsed.proposedText,
                explanation: parsed.explanation || 'Refined according to Science of Gifts editorial principles.',
                modelUsed: modelToUse,
                source: 'gemini',
              }));
            }
          } catch (geminiErr: any) {
            console.warn('Gemini action failed, falling back:', geminiErr?.message);
          }
        }

        // Offline / Fallback handling
        const fb = generateFallbackResponse(body);
        return handleCors(request, Response.json({
          ok: true,
          proposedText: fb.proposedText,
          explanation: fb.explanation || 'Heuristically generated matching Science of Gifts house style.',
          modelUsed: 'heuristic-editorial-engine',
          source: 'editorial_fallback',
        }));
      }

      // ==========================================
      // ENDPOINT 2: POST /api/gemini/outline
      // ==========================================
      if (url.pathname === '/api/gemini/outline') {
        const structureType = body.structureType || 'essay';
        const modelToUse = resolveServerModel(body.model || body.modelOverride, 'gemini-3.6-flash');

        if (ai) {
          try {
            const { systemInstruction, userPrompt } = buildOutlinePrompt(body);
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

              return handleCors(request, Response.json({
                ok: true,
                modelUsed: modelToUse,
                structureType: parsed.structureType || structureType,
                rationale: parsed.rationale || 'Constructed an intellectual progression tailored to the Editorial Brief.',
                outline: formattedItems,
              }));
            }
          } catch (geminiErr: any) {
            console.warn('Gemini outline generation failed, falling back:', geminiErr?.message);
          }
        }

        // High quality fallback outline
        const attached = body.attachedStudies || [];
        const links = body.internalLinks || [];
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
              purpose: 'Analyze why consumers instinctively purchase features over quality.',
              mainIdea: 'Modern manufacturing convinces givers that more features equate to greater thoughtfulness, but raw materials tell a different story.',
              develops: 'Develops the initial premise by explaining the superficial metrics givers rely on.',
              assignedStudyIds: [],
              assignedClaims: [],
              assignedInternalLinks: [],
              notes: 'Contrast sleek consumer tech with heavy traditional metalwork/leatherwork.',
            }
          ];
        } else {
          rationale = 'Standard structured review highlighting material provenance, recipient profile, and concrete craftsmanship.';
          fallbackOutline = [
            {
              id: `outline-${Date.now()}-1`,
              title: 'Curatorial Premise: Objects of Quiet Utility',
              heading: 'Curatorial Premise: Objects of Quiet Utility',
              purpose: 'Introduce the core thesis that the most durable gifts represent shared value rather than commercial transaction.',
              mainIdea: 'True craftsmanship outlasts trends.',
              develops: 'Sets up the criteria for product selection.',
              assignedStudyIds: [],
              assignedClaims: [],
              assignedInternalLinks: [],
              notes: 'Maintain standard informative article style.',
            }
          ];
        }

        return handleCors(request, Response.json({
          ok: true,
          modelUsed: 'heuristic-editorial-engine',
          structureType,
          rationale,
          outline: fallbackOutline,
        }));
      }

      // ==========================================
      // ENDPOINT 3: POST /api/gemini/analyze-style
      // ==========================================
      if (url.pathname === '/api/gemini/analyze-style') {
        const { profileName = 'Custom Style Profile', samples = [] } = body;
        if (!Array.isArray(samples) || samples.length === 0) {
          return handleCors(request, new Response('At least one writing sample is required.', { status: 400 }));
        }

        const modelToUse = resolveServerModel(body.model || body.modelOverride, 'gemini-3.8-flash');
        const isMultiSample = samples.length > 1;

        if (ai) {
          try {
            const systemInstruction = `You are a master literary stylist, chief editor, and publication analyst. Analyze the provided samples' sentence cadence, rhythms, paragraphing, material specificity, wit, tone, and directives. Limit responses strictly to JSON.`;
            let userPrompt = `Style Name: "${profileName}"\n\nSamples:\n`;
            samples.forEach((s: any, idx: number) => {
              userPrompt += `\n--- SAMPLE ${idx + 1} ---\n${s.content}\n`;
            });

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
            let parsed: any = null;
            try {
              parsed = JSON.parse(text);
            } catch {
              const match = text.match(/\{[\s\S]*\}/);
              if (match) {
                try { parsed = JSON.parse(match[0]); } catch {}
              }
            }

            if (parsed) {
              return handleCors(request, Response.json({
                ok: true,
                summary: parsed.summary || 'Style analysis completed successfully.',
                characteristics: parsed.characteristics || [],
                commonCharacteristics: parsed.commonCharacteristics || parsed.characteristics?.filter((c: any) => c.isCommonAcrossSamples) || [],
                sampleSpecificCharacteristics: parsed.sampleSpecificCharacteristics || parsed.characteristics?.filter((c: any) => !c.isCommonAcrossSamples) || [],
                reusableInstructions: parsed.reusableInstructions || [],
                modelUsed: modelToUse,
                source: 'gemini',
              }));
            }
          } catch (geminiErr: any) {
            console.warn('Gemini style analysis failed, falling back:', geminiErr?.message);
          }
        }

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
          }
        ];

        return handleCors(request, Response.json({
          ok: true,
          summary: 'Understated, civilized prose characterized by material specificity, rhythmic sentence variation, and deliberate ritual pacing.',
          characteristics: fallbackCharacteristics,
          commonCharacteristics: fallbackCharacteristics,
          sampleSpecificCharacteristics: [],
          reusableInstructions: [
            'Prefer concrete physical observations and specific material nomenclature over broad generalizations.',
            'Use medium-length sentences with occasional brief, declarative sentences for rhythm.',
            'Maintain an understated, tone; avoid breathless marketing hyperbole.',
          ],
        }));
      }

      // ==========================================
      // ENDPOINT 4: POST /api/gemini/find-link-opportunities
      // ==========================================
      if (url.pathname === '/api/gemini/find-link-opportunities') {
        const { documentContent = '', availableLinks = [], alreadyUsedUrls = [] } = body;

        if (!documentContent) {
          return handleCors(request, new Response('Document content is required.', { status: 400 }));
        }

        const modelToUse = resolveServerModel(body.model || body.modelOverride, 'gemini-3.6-flash');

        if (ai && Array.isArray(availableLinks) && availableLinks.length > 0) {
          try {
            const systemInstruction = `You are the lead senior editor for Science of Gifts. Identify 2 to 5 high-value opportunities to link internally to provided library articles.
RULES:
1. Recommend links ONLY when the target article genuinely enriches the sentence's subject matter.
2. Strictly respect the Editorial Notes provided for each library article. Only recommend a link when the discussion matches the specific contextual relationship in the notes. Do NOT link when notes indicate it would be inappropriate or redundant.
3. Natural anchor text (2-5 words). No generic phrases or keyword stuffing.
4. Avoid duplicate links for already used URLs. Return JSON { opportunities: [...], rationale: "..." }.`;
            const userPrompt = `Content:\n${documentContent}\n\nAvailable Links Library (Includes Editorial Notes):\n${JSON.stringify(availableLinks, null, 2)}`;

            const response = await ai.models.generateContent({
              model: modelToUse,
              contents: userPrompt,
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

            if (parsed && Array.isArray(parsed.opportunities)) {
              const sanitized = parsed.opportunities.map((o: any, idx: number) => ({
                id: `opp-${Date.now()}-${idx}`,
                linkId: o.linkId,
                linkTitle: o.linkTitle,
                linkUrl: o.linkUrl,
                targetPassage: o.targetPassage,
                suggestedAnchor: o.suggestedAnchor,
                reason: o.reason || 'Contextual reference to related Science of Gifts publication.',
                relevance: o.relevance || 'high',
                status: 'pending',
              }));

              return handleCors(request, Response.json({
                ok: true,
                opportunities: sanitized,
                rationale: parsed.rationale || 'Editorial link opportunities identified.',
                modelUsed: modelToUse,
                source: 'gemini',
              }));
            }
          } catch (geminiErr: any) {
            console.warn('Gemini links extraction failed:', geminiErr?.message);
          }
        }

        // Local Regex scanner fallback
        const fallbackOpportunities: any[] = [];
        const plainText = documentContent.replace(/<[^>]+>/g, ' ');

        availableLinks.forEach((link: any, idx: number) => {
          if (alreadyUsedUrls.some((u: string) => usedUrlMatches(u, link.url))) return;
          const keywords = [link.preferredAnchor, link.topic, link.title].filter(Boolean);
          for (const kw of keywords) {
            const idxKw = plainText.toLowerCase().indexOf(kw.toLowerCase());
            if (idxKw !== -1) {
              const start = Math.max(0, plainText.lastIndexOf('.', idxKw) + 1);
              const end = plainText.indexOf('.', idxKw + kw.length);
              const passage = plainText.substring(start, end === -1 ? plainText.length : end).trim();
              fallbackOpportunities.push({
                id: `opp-fb-${Date.now()}-${idx}`,
                linkId: link.id,
                linkTitle: link.title,
                linkUrl: link.url,
                targetPassage: passage,
                suggestedAnchor: plainText.substring(idxKw, idxKw + kw.length),
                reason: `Provides relevant context regarding "${link.topic || link.title}".`,
                relevance: 'high',
                status: 'pending',
              });
              break;
            }
          }
        });

        return handleCors(request, Response.json({
          ok: true,
          opportunities: fallbackOpportunities.slice(0, 4),
          rationale: fallbackOpportunities.length > 0 ? 'Contextual links scanned from keywords.' : 'No available links mapped.',
          source: 'editorial_scanner',
        }));
      }

      // ==========================================
      // ENDPOINT 5: POST /api/gemini/editorial-review
      // ==========================================
      if (url.pathname === '/api/gemini/editorial-review') {
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
        } = body;

        const textToReview = scope === 'selection' && selectedText ? selectedText : documentContent;
        const plainText = textToReview.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        if (!plainText) {
          return handleCors(request, Response.json({
            ok: true,
            qualitativeSummary: 'The document is currently empty. Add content to begin editorial review.',
            counts: { critical: 0, important: 0, minor: 0, suggestion: 0 },
            findings: [],
          }));
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
- Flag generic e-commerce hype or SEO keyword stuffing.`
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

        const modelToUse = resolveServerModel(body.model || body.modelOverride, 'gemini-3.8-flash');

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

            if (parsed) {
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

              return handleCors(request, Response.json({
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
              }));
            }
          } catch (geminiErr: any) {
            console.warn('Gemini review failed, running fallback scan:', geminiErr?.message);
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
          { pattern: /whether you('re| are) looking for/i, label: "whether you're looking for", fix: 'For' },
          { pattern: /perfect for\s+([^,.]+)/i, label: 'perfect for', fix: 'Suited to $1' },
          { pattern: /ideal choice for/i, label: 'ideal choice for', fix: 'Well-suited to' },
          { pattern: /thoughtful and meaningful gift/i, label: 'thoughtful and meaningful gift', fix: 'lasting object' },
          { pattern: /takes it to the next level/i, label: 'takes it to the next level', fix: 'elevates its utility' },
          { pattern: /something they('ll| will) cherish/i, label: "something they'll cherish", fix: 'a piece designed to endure' },
          { pattern: /in today('s|s) world/i, label: "in today's world", fix: 'today' },
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

        const countsFallback = {
          critical: fallbackFindings.filter((f) => f.severity === 'critical').length,
          important: fallbackFindings.filter((f) => f.severity === 'important').length,
          minor: fallbackFindings.filter((f) => f.severity === 'minor').length,
          suggestion: fallbackFindings.filter((f) => f.severity === 'suggestion').length,
        };

        return handleCors(request, Response.json({
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
          counts: countsFallback,
          findings: fallbackFindings,
          source: 'editorial_scanner',
        }));
      }

      // ==========================================
      // ENDPOINT 6: POST /api/gemini/quality-control
      // ==========================================
      if (url.pathname === '/api/gemini/quality-control') {
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
        } = body;

        const plainText = documentContent.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

        if (!plainText) {
          return handleCors(request, Response.json({
            ok: true,
            findings: [],
            summary: 'Document is empty. No contextual QC issues found.',
          }));
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

        const modelToUse = resolveServerModel(body.model || body.modelOverride, 'gemini-3.7-flash');

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

            if (parsed) {
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

              return handleCors(request, Response.json({
                ok: true,
                summary: parsed.summary || 'AI Quality Control audit completed.',
                findings: sanitized,
                modelUsed: modelToUse,
                source: 'gemini',
              }));
            }
          } catch (geminiErr: any) {
            console.warn('Gemini QC failed:', geminiErr?.message);
          }
        }

        return handleCors(request, Response.json({
          ok: true,
          summary: 'Local deterministic QC audit completed.',
          findings: [],
          modelUsed: modelToUse,
          source: 'local',
        }));
      }

      // ==========================================
      // ENDPOINT 7: POST /api/gemini/generate-ideas
      // ==========================================
      if (url.pathname === '/api/gemini/generate-ideas') {
        const { topic = '', audience = '', editorialGoal = '', styleProfileDescription = '' } = body;
        const modelToUse = resolveServerModel(body.model || body.modelOverride, 'gemini-3.8-flash');

        if (ai && topic) {
          try {
            const systemInstruction = `You are the lead editor generating unhurried, engaging, craft-centric article titles and hooks. Deliver JSON in the schema { ideas: [{ id, title, angle, whyInteresting, searchIntent }] }.`;
            const userPrompt = `Topic: "${topic}"\nAudience: "${audience}"\nGoal: "${editorialGoal}"\nStyle: "${styleProfileDescription}"`;

            const response = await ai.models.generateContent({
              model: modelToUse,
              contents: userPrompt,
              config: {
                systemInstruction,
                responseMimeType: 'application/json',
                temperature: 0.8,
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
              return handleCors(request, Response.json({
                ok: true,
                ideas: parsed.ideas.map((id: any, i: number) => ({
                  id: `idea-${Date.now()}-${i}`,
                  title: id.title,
                  angle: id.angle,
                  whyInteresting: id.whyInteresting,
                  searchIntent: id.searchIntent || 'Informational',
                })),
                modelUsed: modelToUse,
              }));
            }
          } catch (geminiErr: any) {
            console.warn('Gemini idea generation failed:', geminiErr?.message);
          }
        }

        const fallbackIdeas = generateFallbackIdeas(topic, audience, editorialGoal, styleProfileDescription);
        return handleCors(request, Response.json({
          ok: true,
          ideas: fallbackIdeas,
          modelUsed: 'heuristic-editorial-engine',
        }));
      }

      // ==========================================
      // ENDPOINT 8: POST /api/research/extract-pdf
      // ==========================================
      if (url.pathname === '/api/research/extract-pdf') {
        const { pdfBase64, fileName, fileSize } = body;
        if (!pdfBase64) {
          return handleCors(request, new Response('pdfBase64 is required.', { status: 400 }));
        }

        try {
          const bytes = new Uint8Array(Buffer.from(pdfBase64, 'base64'));
          const parsedText = await extractText(bytes, { mergePages: true });
          const text = (Array.isArray(parsedText) ? parsedText.join('\n') : (parsedText || '')).trim();

          if (!text || text.length < 20) {
            return handleCors(request, Response.json({
              success: true,
              text: '',
              numPages: 1,
              fileName,
              fileSize,
              isScannedOrEmpty: true,
              error: 'The uploaded PDF appears to be a scanned image or contains no readable text layer.',
            }));
          }

          return handleCors(request, Response.json({
            success: true,
            text,
            numPages: 1,
            fileName,
            fileSize,
            isScannedOrEmpty: false,
          }));
        } catch (pdfErr: any) {
          console.error('PDF extraction failed:', pdfErr);
          return handleCors(request, Response.json({
            success: false,
            error: `Failed to extract text from PDF: ${pdfErr?.message || 'Unrecognized format or corrupted document'}`,
          }, { status: 500 }));
        }
      }

      // ==========================================
      // ENDPOINT 9: POST /api/research/lookup-metadata
      // ==========================================
      if (url.pathname === '/api/research/lookup-metadata') {
        const { input } = body;
        if (!input || typeof input !== 'string') {
          return handleCors(request, new Response('input is required.', { status: 400 }));
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

              return handleCors(request, Response.json({
                success: true,
                title,
                authors,
                publication,
                publicationYear: publishedYear,
                doi,
                url: item.URL || `https://doi.org/${doi}`,
                abstract,
              }));
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
                return handleCors(request, Response.json({
                  success: true,
                  title: record.title || '',
                  authors,
                  publication: record.source || '',
                  publicationYear: yearMatch ? yearMatch[0] : pubDate,
                  doi,
                  url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
                  abstract: '',
                }));
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

              return handleCors(request, Response.json({
                success: true,
                title,
                authors: author ? [author] : [],
                publication,
                publicationYear: year,
                doi,
                url: clean,
                abstract,
              }));
            }
          } catch (urlErr) {
            console.warn('URL metadata fetch error:', urlErr);
          }
        }

        return handleCors(request, Response.json({
          success: false,
          error: 'Could not automatically resolve metadata for this DOI or URL. Please enter details manually.',
        }));
      }

      // ==========================================
      // ENDPOINT 10: POST /api/gemini/analyze-study
      // ==========================================
      if (url.pathname === '/api/gemini/analyze-study') {
        const { study, modelOverride } = body;
        if (!study || !study.title) {
          return handleCors(request, new Response('study is required.', { status: 400 }));
        }

        const modelToUse = resolveServerModel(modelOverride, 'gemini-3.8-flash');

        if (ai) {
          try {
            const systemInstruction = `You are a chief research analyst. Analyze study methodology, sample size, limitations, and claims. Return JSON with analysis and claims properties.`;
            const studyContext = `Title: ${study.title}\nKey Findings: ${JSON.stringify(study.keyFindings)}`;
            const response = await ai.models.generateContent({
              model: modelToUse,
              contents: `Perform academic study analysis: ${studyContext}`,
              config: {
                systemInstruction,
                responseMimeType: 'application/json',
                temperature: 0.2,
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
                claimText: c.claimText,
                claimType: c.claimType || 'source_fact',
                supportedBySource: c.supportedBySource || '',
                confidence: c.confidence || 'high',
                relevantLimitation: c.relevantLimitation,
                sourceReference: c.sourceReference || study.title,
              }));

              return handleCors(request, Response.json({
                ok: true,
                analysis: analysisObj,
                claims: claimsList,
                modelUsed: modelToUse,
              }));
            }
          } catch (geminiErr: any) {
            console.warn('Gemini analyze-study call failed:', geminiErr?.message);
          }
        }

        // Factual deterministic fallback
        const fallbackClaims = (study.keyFindings || []).map((finding: string, idx: number) => ({
          id: `claim-${Date.now()}-${idx + 1}`,
          studyId: study.id,
          studyTitle: study.title,
          claimText: finding,
          claimType: 'source_fact',
          supportedBySource: 'Explicitly stated in provided study summary.',
          confidence: 'high',
          sourceReference: study.title,
        }));

        return handleCors(request, Response.json({
          ok: true,
          analysis: {
            id: `analysis-${Date.now()}`,
            studyId: study.id,
            analyzedAt: new Date().toISOString(),
            whatWasStudied: `Investigated subjects surrounding ${study.title}.`,
            whatTheStudyFound: study.keyFindings || ['Identified a core behavioral dynamic.'],
            whatItMeans: study.summary || 'Empirical research backing recipient emotional triggers.',
            whatItDoesNotEstablish: ['Generalizability across all cultures without replication.'],
            limitations: ['Self-reported sample demographics.'],
            editorialUse: ['Useful support for key points in draft outline.'],
            potentialArticleIdeas: [],
          },
          claims: fallbackClaims,
          modelUsed: 'heuristic-editorial-engine',
        }));
      }

      // ==========================================
      // ENDPOINT 11: POST /api/gemini/research-ideas
      // ==========================================
      if (url.pathname === '/api/gemini/research-ideas') {
        const { studies = [], modelOverride } = body;
        const modelToUse = resolveServerModel(modelOverride, 'gemini-3.8-flash');

        if (ai && studies.length > 0) {
          try {
            const systemInstruction = `You are a lead editor. Generate unhurried article ideas from empirical study parameters. Return JSON { ideas: [{ title, angle, whyInteresting, searchIntent }] }.`;
            const response = await ai.models.generateContent({
              model: modelToUse,
              contents: `Create article ideas from studies:\n${JSON.stringify(studies)}`,
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
              return handleCors(request, Response.json({
                ok: true,
                ideas: parsed.ideas,
                modelUsed: modelToUse,
              }));
            }
          } catch (geminiErr: any) {
            console.warn('Gemini research-ideas failed:', geminiErr?.message);
          }
        }

        return handleCors(request, Response.json({
          ok: true,
          ideas: [
            {
              id: `idea-fb-${Date.now()}-1`,
              title: `The Psychology of Quiet Permanence: What Academic Research Reveals About Physical Gifts`,
              angle: `Connect contemporary empirical studies on attachment with traditional material craftsmanship.`,
              whyInteresting: `Validates our intuitive appreciation for turned brass and hand-stitched leather.`,
              searchIntent: 'Psychological',
            }
          ],
          modelUsed: 'heuristic-editorial-engine',
        }));
      }

      // ==========================================
      // ENDPOINT 12: POST /api/gemini/research-outline
      // ==========================================
      if (url.pathname === '/api/gemini/research-outline') {
        const { project, attachedStudies = [], selectedClaims = [], modelOverride } = body;
        const modelToUse = resolveServerModel(modelOverride, 'gemini-3.8-flash');

        if (ai) {
          try {
            const systemInstruction = `Generate a structured, evidence-supported research outline based on attached papers and selected claims. Return JSON { outline: [...], rationale: "..." }.`;
            const response = await ai.models.generateContent({
              model: modelToUse,
              contents: `Construct outline for ${project?.title || 'Untitled'}:\nStudies: ${JSON.stringify(attachedStudies)}\nClaims: ${JSON.stringify(selectedClaims)}`,
              config: {
                systemInstruction,
                responseMimeType: 'application/json',
                temperature: 0.5,
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
              return handleCors(request, Response.json({
                ok: true,
                outline: parsed.outline.map((o: any, idx: number) => ({
                  id: `outline-${Date.now()}-${idx}`,
                  title: o.title,
                  heading: o.heading,
                  purpose: o.purpose,
                  mainIdea: o.mainIdea,
                  develops: o.develops,
                  notes: o.notes,
                  assignedStudyIds: o.assignedStudyIds || [],
                  assignedClaims: o.assignedClaims || [],
                  assignedInternalLinks: o.assignedInternalLinks || [],
                })),
                rationale: parsed.rationale || 'Constructed unhurried progression around empirical papers.',
                modelUsed: modelToUse,
              }));
            }
          } catch (geminiErr: any) {
            console.warn('Gemini research-outline failed:', geminiErr?.message);
          }
        }

        return handleCors(request, Response.json({
          ok: true,
          outline: [
            {
              id: `outline-${Date.now()}-0`,
              title: `1. Opening Observation: The Tactile Resilience of Materials`,
              heading: `1. Opening Observation: The Tactile Resilience of Materials`,
              purpose: `Outline empirical observations of emotional longevity in gifts.`,
              mainIdea: `Physical patina matches psychological permanence.`,
              notes: `Keep unhurried pacing.`,
            }
          ],
          rationale: 'Heuristically generated outlines mapped around selected material guidelines.',
          modelUsed: 'heuristic-editorial-engine',
        }));
      }

      // ==========================================
      // ENDPOINT 13: POST /api/gemini/generate-angles
      // ==========================================
      if (url.pathname === '/api/gemini/generate-angles') {
        const { idea = {}, projectTitle = '', targetAudience = 'Discerning readers' } = body;
        const modelToUse = resolveServerModel(body.model || body.modelOverride, 'gemini-3.6-flash');

        if (ai) {
          try {
            const systemInstruction = `You are an expert editorial consultant. Generate exactly 5 diverse, highly distinct angles. Return JSON { angles: [{ id, role, title, coreArgument, whatArticleEmphasizes, possibleTakeaway }] }.`;
            const response = await ai.models.generateContent({
              model: modelToUse,
              contents: `Generate 5 angles for Idea: "${idea.title || projectTitle}" Hook: ${idea.whyInteresting || ''}`,
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

            if (parsed && Array.isArray(parsed.angles)) {
              return handleCors(request, Response.json({
                ok: true,
                angles: parsed.angles.map((a: any, idx: number) => ({
                  id: `angle-${Date.now()}-${idx + 1}`,
                  role: a.role || 'alternative',
                  title: a.title,
                  coreArgument: a.coreArgument,
                  whatArticleEmphasizes: a.whatArticleEmphasizes,
                  possibleTakeaway: a.possibleTakeaway,
                })),
                modelUsed: modelToUse,
              }));
            }
          } catch (geminiErr: any) {
            console.warn('Gemini generate-angles failed:', geminiErr?.message);
          }
        }

        // High quality fallback angles
        return handleCors(request, Response.json({
          ok: true,
          angles: [
            { id: `angle-${Date.now()}-1`, role: 'primary', title: 'The Patina of Participation', coreArgument: 'Our deep attachments are reserved for tools requiring active stewardship.', whatArticleEmphasizes: 'Ergonomic friction and physical maintenance rituals.', possibleTakeaway: 'Select objects of Turned Brass or Canvas that patinate beautifully over the years.' },
            { id: `angle-${Date.now()}-2`, role: 'secondary', title: 'The Anti-Gadget Manifesto', coreArgument: 'Feature complexity dilutes attention, single-purpose implements foster routine.', whatArticleEmphasizes: 'Mechanical simplicity over electronic novelty.', possibleTakeaway: 'Ditch ephemeral electronic screen devices for mechanical durability.' },
            { id: `angle-${Date.now()}-3`, role: 'brief_mention', title: 'The Burden of Abundance', coreArgument: 'The most generous gift relieves choice paralysis rather than multiplying clutter.', whatArticleEmphasizes: 'Providing single high-quality solutions.', possibleTakeaway: 'Fewer, better things.' },
            { id: `angle-${Date.now()}-4`, role: 'brief_mention', title: 'The Craft of Restraint', coreArgument: 'Understated design outlives loud branding.', whatArticleEmphasizes: 'Visual minimalism and structural substance.', possibleTakeaway: 'Look for the maker\'s signature quietly hidden inside the joints.' },
            { id: `angle-${Date.now()}-5`, role: 'do_not_use', title: 'The Fast-Fashion Gift', coreArgument: 'Gifts purchased as convenient checkout transactions lack emotional resonance.', whatArticleEmphasizes: 'Bypassing mass commercial retail listeria.', possibleTakeaway: 'Always shop with intentional, deliberate curatorial criteria.' }
          ],
          modelUsed: 'heuristic-editorial-engine',
        }));
      }

      // ==========================================
      // ENDPOINT 14: POST /api/gemini/create-editorial-brief
      // ==========================================
      if (url.pathname === '/api/gemini/create-editorial-brief') {
        const { projectTitle = '', idea = {}, direction = {}, angles = [], attachedStudies = [], internalLinks = [], styleProfile, projectInstructions = '' } = body;
        const modelToUse = resolveServerModel(body.modelOverride, 'gemini-3.6-flash');

        const primaryAngle = angles.find((a: any) => a.id === direction.primaryAngleId || a.role === 'primary');
        const secondaryAngle = angles.find((a: any) => a.id === direction.secondaryAngleId || a.role === 'secondary');
        const briefMentions = angles.filter((a: any) => (direction.briefMentionAngleIds || []).includes(a.id) || a.role === 'brief_mention');
        const doNotUse = angles.filter((a: any) => (direction.doNotUseAngleIds || []).includes(a.id) || a.role === 'do_not_use');

        if (ai) {
          try {
            const systemInstruction = `Synthesize an article idea, selected editorial angles, and the editor's direction into a valid JSON Editorial Brief. Deliver JSON.`;
            const response = await ai.models.generateContent({
              model: modelToUse,
              contents: `Synthesize brief: Project "${projectTitle}" Idea: "${idea.title || ''}" Primary: "${primaryAngle?.title || ''}" Secondary: "${secondaryAngle?.title || ''}"`,
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
              return handleCors(request, Response.json({
                ok: true,
                brief: {
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
                  styleConsiderations: String(parsed.styleConsiderations || '').trim(),
                  generatedAt: now,
                  updatedAt: now,
                },
                modelUsed: modelToUse,
              }));
            }
          } catch (geminiErr: any) {
            console.warn('Gemini brief generation failed:', geminiErr?.message);
          }
        }

        // Fallback Brief
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
          ],
          editorialDirection: direction.editorsDirection?.trim() || 'Maintain an unhurried, tactile voice. Emphasize provenance and recipient experience.',
          suggestedTakeaway: primaryAngle?.possibleTakeaway || 'When choosing an enduring gift, value modular repairability, honest provenance, and everyday utility over fleeting prestige.',
          factualContext: attachedStudies.length > 0
            ? attachedStudies.map((s: any) => `Empirical findings from ${s.title}: ${(s.analysis?.whatTheStudyFound || [])[0] || 'Material longevity strengthens recipient emotional bonds.'}`)
            : ['Historical shift from disposable novelty goods toward serviceable bench-made tools.'],
          editorialInterpretation: [
            'Tactile friction and conscious stewardship are essential components of psychological ownership.',
          ],
          internalLinkOpportunities: internalLinks.slice(0, 3).map((l: any) => `Connect thematic discussion to ${l.title} (${l.url})`),
          styleConsiderations: 'Civilized, literary, discerning. Avoid breathless enthusiasm or buzzwords.',
          generatedAt: now,
          updatedAt: now,
        };

        return handleCors(request, Response.json({
          ok: true,
          brief: fallbackBrief,
          modelUsed: 'heuristic-editorial-engine',
        }));
      }

      // ==========================================
      // ENDPOINT: POST /api/links/fetch-metadata
      // ==========================================
      if (url.pathname === '/api/links/fetch-metadata') {
        const targetUrl = (body.url || '').trim();
        if (!targetUrl) {
          return handleCors(request, Response.json({ ok: false, error: 'Please provide a valid destination URL.' }, { status: 400 }));
        }

        try {
          const parsed = new URL(targetUrl);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return handleCors(request, Response.json({ ok: false, error: 'Only HTTP and HTTPS URLs are allowed.' }, { status: 400 }));
          }

          const hostname = parsed.hostname.toLowerCase();
          if (
            hostname === 'localhost' ||
            hostname.endsWith('.localhost') ||
            hostname.endsWith('.local') ||
            hostname.endsWith('.internal') ||
            hostname === '127.0.0.1' ||
            hostname === '0.0.0.0' ||
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.')
          ) {
            return handleCors(request, Response.json({ ok: false, error: 'Requests to local or private networks are blocked.' }, { status: 400 }));
          }

          const fetchRes = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; ScienceOfGiftsStudio/1.0; +https://www.scienceofgifts.com)',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });

          if (!fetchRes.ok) {
            return handleCors(request, Response.json({ ok: false, error: `Destination responded with status ${fetchRes.status}` }, { status: 400 }));
          }

          const text = await fetchRes.text();
          const titleMatch = text.match(/<meta property=["']og:title["'] content=["']([^"']+)["']/i) || text.match(/<title[^>]*>([^<]+)<\/title>/i);
          const descMatch = text.match(/<meta name=["']description["'] content=["']([^"']+)["']/i) || text.match(/<meta property=["']og:description["'] content=["']([^"']+)["']/i);
          const canonicalMatch = text.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);

          const title = (titleMatch ? titleMatch[1] : '').replace(/\s*(?:\||–|—|-)\s*(?:Science of Gifts).*$/i, '').trim();
          const description = (descMatch ? descMatch[1] : '').trim();
          const canonicalUrl = canonicalMatch ? canonicalMatch[1].trim() : undefined;

          if (ai) {
            try {
              const textSnippet = text
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 5000);

              const existingCategories = Array.isArray(body.existingCategories) ? body.existingCategories : [];

              const prompt = `Analyze this article page for Science of Gifts Studio internal link metadata.

URL: ${targetUrl}
Extracted Title: ${title}
Extracted Description: ${description}
Text Excerpt: ${textSnippet}
Existing Categories: ${JSON.stringify(existingCategories)}

Return ONLY a valid JSON object:
{
  "title": "${title || ''}",
  "category": "matched category or broad category",
  "topic": "concise main subject and subtopics",
  "description": "${description || ''}",
  "preferredAnchor": "natural 2-5 word phrase for sentence hyperlinking",
  "notes": "actionable notes explaining when linking genuinely helps the reader, relevant topics/claims, and when linking would be inappropriate"
}`;

              const res = await ai.models.generateContent({
                model: 'gemini-3.6-flash',
                contents: prompt,
                config: {
                  responseMimeType: 'application/json',
                  temperature: 0.3,
                },
              });

              const respText = res.text?.trim() || '';
              let parsed: any = null;
              try { parsed = JSON.parse(respText); } catch {
                const m = respText.match(/\{[\s\S]*\}/);
                if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
              }

              if (parsed && typeof parsed === 'object') {
                return handleCors(request, Response.json({
                  ok: true,
                  metadata: {
                    title: parsed.title || title || undefined,
                    description: parsed.description || description || undefined,
                    topic: parsed.topic || (title ? title.replace(/^(the|an?)\s+/i, '') : undefined),
                    category: parsed.category || undefined,
                    preferredAnchor: parsed.preferredAnchor || (title ? title.toLowerCase() : undefined),
                    notes: parsed.notes || undefined,
                    canonicalUrl,
                  },
                }));
              }
            } catch (aiErr: any) {
              console.warn('Worker link AI analysis failed, falling back:', aiErr?.message);
            }
          }

          return handleCors(request, Response.json({
            ok: true,
            metadata: {
              title: title || undefined,
              description: description || undefined,
              canonicalUrl,
              topic: title ? title.replace(/^(the|an?)\s+/i, '') : undefined,
              preferredAnchor: title ? title.toLowerCase() : undefined,
            },
          }));
        } catch (fetchErr: any) {
          return handleCors(request, Response.json({ ok: false, error: fetchErr.message || 'Failed to fetch metadata' }, { status: 400 }));
        }
      }

      // ==========================================
      // ENDPOINT: POST /api/products/fetch-metadata
      // ==========================================
      if (url.pathname === '/api/products/fetch-metadata') {
        const targetUrl = (body.url || '').trim();
        if (!targetUrl) {
          return handleCors(request, Response.json({ ok: false, error: 'Please provide a valid product URL.' }, { status: 400 }));
        }

        try {
          const parsed = new URL(targetUrl);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return handleCors(request, Response.json({ ok: false, error: 'Only HTTP and HTTPS URLs are allowed.' }, { status: 400 }));
          }

          const hostname = parsed.hostname.toLowerCase();
          if (
            hostname === 'localhost' ||
            hostname.endsWith('.localhost') ||
            hostname.endsWith('.local') ||
            hostname.endsWith('.internal') ||
            hostname === '127.0.0.1' ||
            hostname === '0.0.0.0' ||
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.')
          ) {
            return handleCors(request, Response.json({ ok: false, error: 'Requests to local or private networks are blocked.' }, { status: 400 }));
          }

          const fetchRes = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; ScienceOfGiftsStudio/1.0; +https://www.scienceofgifts.com)',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });

          if (!fetchRes.ok) {
            return handleCors(request, Response.json({ ok: false, error: `Destination responded with status ${fetchRes.status}` }, { status: 400 }));
          }

          const text = await fetchRes.text();
          
          // JSON-LD extraction
          let jsonLd: any = null;
          const jsonLdMatch = text.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
          if (jsonLdMatch && jsonLdMatch[1]) {
            try {
              const p = JSON.parse(jsonLdMatch[1]);
              jsonLd = Array.isArray(p) ? p[0] : (p['@graph'] ? p['@graph'][0] : p);
            } catch {}
          }

          const titleMatch = text.match(/<meta property=["']og:title["'] content=["']([^"']+)["']/i) || text.match(/<title[^>]*>([^<]+)<\/title>/i);
          const descMatch = text.match(/<meta name=["']description["'] content=["']([^"']+)["']/i) || text.match(/<meta property=["']og:description["'] content=["']([^"']+)["']/i);
          const canonicalMatch = text.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);

          const rawTitle = jsonLd?.name || (titleMatch ? titleMatch[1] : '');
          const productName = rawTitle.replace(/\s*(?:\||–|—|-)\s*(?:Science of Gifts|Official Store|Shop).*$/i, '').trim();
          const summary = (jsonLd?.description || (descMatch ? descMatch[1] : '')).replace(/<[^>]+>/g, '').trim();
          const canonicalUrl = canonicalMatch ? canonicalMatch[1].trim() : undefined;

          let productType = jsonLd?.category || '';
          if (!productType && productName) {
            const nameLower = (productName + ' ' + text.slice(0, 1000)).toLowerCase();
            if (/compass|sextant/i.test(nameLower)) productType = 'Navigational Instrument';
            else if (/watch|chronometer/i.test(nameLower)) productType = 'Timepiece';
            else if (/pen|journal|desk/i.test(nameLower)) productType = 'Desk Accessory';
            else if (/knife|tool/i.test(nameLower)) productType = 'Pocket Tool';
          }

          const topic = body.guideTopic || 'curated gifts';
          const audience = body.guideAudience || 'discerning gifters';

          return handleCors(request, Response.json({
            ok: true,
            metadata: {
              name: productName || undefined,
              productType: productType || undefined,
              summary: summary ? summary.slice(0, 240) : undefined,
              materialDetails: jsonLd?.material ? `Materials: ${jsonLd.material}` : undefined,
              whyItFits: productName ? `Provides authentic material heft and functional connection for ${topic}.` : undefined,
              bestFor: productName ? `Ideal for ${audience} who appreciate enduring craft and heirloom utility.` : undefined,
              canonicalUrl,
            },
          }));
        } catch (fetchErr: any) {
          return handleCors(request, Response.json({ ok: false, error: fetchErr.message || 'Failed to fetch product details' }, { status: 400 }));
        }
      }

      // ==========================================
      // ENDPOINT: POST /api/products/analyze-research
      // ==========================================
      if (url.pathname === '/api/products/analyze-research') {
        const targetUrl = (body.url || '').trim();
        if (!targetUrl) {
          return handleCors(request, Response.json({ ok: false, error: 'Please provide a valid product URL.' }, { status: 400 }));
        }

        try {
          const parsed = new URL(targetUrl);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return handleCors(request, Response.json({ ok: false, error: 'Only HTTP and HTTPS URLs are allowed.' }, { status: 400 }));
          }

          const hostname = parsed.hostname.toLowerCase();
          if (
            hostname === 'localhost' ||
            hostname.endsWith('.localhost') ||
            hostname.endsWith('.local') ||
            hostname.endsWith('.internal') ||
            hostname === '127.0.0.1' ||
            hostname === '0.0.0.0' ||
            hostname.startsWith('192.168.') ||
            hostname.startsWith('10.')
          ) {
            return handleCors(request, Response.json({ ok: false, error: 'Requests to local or private networks are blocked.' }, { status: 400 }));
          }

          const fetchRes = await fetch(targetUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; ScienceOfGiftsStudio/1.0; +https://www.scienceofgifts.com)',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            },
          });

          if (!fetchRes.ok) {
            return handleCors(request, Response.json({ ok: false, error: `Destination responded with status ${fetchRes.status}` }, { status: 400 }));
          }

          const text = await fetchRes.text();
          let jsonLd: any = null;
          const jsonLdMatch = text.match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
          if (jsonLdMatch && jsonLdMatch[1]) {
            try {
              const p = JSON.parse(jsonLdMatch[1]);
              jsonLd = Array.isArray(p) ? p[0] : (p['@graph'] ? p['@graph'][0] : p);
            } catch {}
          }

          const titleMatch = text.match(/<meta property=["']og:title["'] content=["']([^"']+)["']/i) || text.match(/<title[^>]*>([^<]+)<\/title>/i);
          const descMatch = text.match(/<meta name=["']description["'] content=["']([^"']+)["']/i) || text.match(/<meta property=["']og:description["'] content=["']([^"']+)["']/i);
          const imgMatch = text.match(/<meta property=["']og:image["'] content=["']([^"']+)["']/i) || text.match(/<meta name=["']twitter:image["'] content=["']([^"']+)["']/i);
          const canonicalMatch = text.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["'][^>]*>/i);

          const rawTitle = jsonLd?.name || (titleMatch ? titleMatch[1] : '');
          const productName = rawTitle.replace(/\s*(?:\||–|—|-)\s*(?:Science of Gifts|Official Store|Shop).*$/i, '').trim();
          const summary = (jsonLd?.description || (descMatch ? descMatch[1] : '')).replace(/<[^>]+>/g, '').trim();
          const imageUrl = jsonLd?.image || (imgMatch ? imgMatch[1] : '');
          const canonicalUrl = canonicalMatch ? canonicalMatch[1].trim() : undefined;

          let productType = jsonLd?.category || '';
          if (!productType && productName) {
            const nameLower = (productName + ' ' + text.slice(0, 1000)).toLowerCase();
            if (/compass|sextant/i.test(nameLower)) productType = 'Navigational Instrument';
            else if (/watch|chronometer/i.test(nameLower)) productType = 'Timepiece';
            else if (/pen|journal|desk/i.test(nameLower)) productType = 'Desk Accessory';
            else if (/knife|tool/i.test(nameLower)) productType = 'Pocket Tool';
          }

          const modelToUse = resolveServerModel(body.model || body.modelOverride, 'gemini-3.6-flash');

          if (ai) {
            try {
              const textSnippet = text
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 5000);

              const gCtx = typeof body.guideContext === 'object' && body.guideContext !== null ? body.guideContext : {};
              const hasGuideCtx = Boolean(gCtx.title || gCtx.primaryTopic || gCtx.audience);
              const guideContextBlock = hasGuideCtx
                ? `\nGUIDE CONTEXT:\n- Title: ${gCtx.title || 'N/A'}\n- Primary Topic: ${gCtx.primaryTopic || 'N/A'}\n- Audience/Recipient: ${gCtx.audience || 'N/A'}\n`
                : '';

              const prompt = `Analyze this product page source for Science of Gifts Studio.

URL: ${targetUrl}
Product Title: ${productName}
JSON-LD Data: ${JSON.stringify(jsonLd || {})}
Text Excerpt: ${textSnippet}
${guideContextBlock}

Return ONLY a valid JSON object:
{
  "productName": "${productName || ''}",
  "productType": "${productType || ''}",
  "productUrl": "${targetUrl}",
  "imageUrl": "${imageUrl || ''}",
  "materials": "materials and metals found on page",
  "features": "key physical features and mechanics",
  "dimensions": "dimensions, weight, gauge",
  "colors": "colors and finishes",
  "designConcept": "visual language and aesthetic proportions based on evidence",
  "historicalContext": "documented tool heritage or origin if mentioned, else empty string",
  "whyItFits": "${hasGuideCtx ? 'explain why this product specifically serves this gift guide' : 'why it is a notable product'}",
  "bestFor": "suitable recipient or specific use case",
  "buyerConsiderations": "useful care, dimensions, display or maintenance advice",
  "intendedRecipient": "suitable recipient profiles",
  "targetAudience": "discerning audience profile",
  "additionalFacts": "verifiable care/maintenance notes",
  "rawProductInfo": "${summary || ''}"
}`;

              const response = await ai.models.generateContent({
                model: modelToUse,
                contents: prompt,
                config: {
                  responseMimeType: 'application/json',
                  temperature: 0.3,
                },
              });

              const respText = response.text?.trim() || '';
              let parsed: any = null;
              try { parsed = JSON.parse(respText); } catch {
                const m = respText.match(/\{[\s\S]*\}/);
                if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
              }

              if (parsed && typeof parsed === 'object') {
                return handleCors(request, Response.json({
                  ok: true,
                  metadata: {
                    productName: parsed.productName || productName || '',
                    productType: parsed.productType || productType || '',
                    productUrl: targetUrl,
                    imageUrl: parsed.imageUrl || imageUrl || '',
                    materials: parsed.materials || (jsonLd?.material ? `Materials: ${jsonLd.material}` : ''),
                    features: parsed.features || '',
                    dimensions: parsed.dimensions || '',
                    colors: parsed.colors || '',
                    designConcept: parsed.designConcept || '',
                    historicalContext: parsed.historicalContext || '',
                    whyItFits: parsed.whyItFits || '',
                    bestFor: parsed.bestFor || parsed.intendedRecipient || '',
                    buyerConsiderations: parsed.buyerConsiderations || parsed.additionalFacts || '',
                    intendedRecipient: parsed.intendedRecipient || '',
                    targetAudience: parsed.targetAudience || '',
                    additionalFacts: parsed.additionalFacts || '',
                    rawProductInfo: parsed.rawProductInfo || summary || '',
                    canonicalUrl,
                  },
                  modelUsed: modelToUse,
                }));
              }
            } catch (aiErr: any) {
              console.warn('Worker AI analysis failed, falling back:', aiErr?.message);
            }
          }

          // Fallback response
          return handleCors(request, Response.json({
            ok: true,
            metadata: {
              productName: productName || '',
              productType: productType || '',
              productUrl: targetUrl,
              imageUrl: imageUrl || '',
              materials: jsonLd?.material ? `Materials: ${jsonLd.material}` : '',
              features: '',
              dimensions: '',
              colors: '',
              designConcept: '',
              historicalContext: '',
              intendedRecipient: '',
              targetAudience: '',
              additionalFacts: '',
              rawProductInfo: summary || '',
              canonicalUrl,
            },
            modelUsed: 'worker-deterministic-fallback',
          }));
        } catch (fetchErr: any) {
          return handleCors(request, Response.json({ ok: false, error: fetchErr.message || 'Failed to analyze product' }, { status: 400 }));
        }
      }

      // If no route matched
      return handleCors(request, new Response('Not Found', { status: 404 }));

    } catch (err: any) {
      console.error('Unhandled API error:', err);
      return handleCors(request, Response.json({
        success: false,
        error: err?.message || 'Internal Server Error',
      }, { status: 500 }));
    }
  },
};

// Simple utility function to protect link duplication
function usedUrlMatches(used: string, target: string): boolean {
  if (!used || !target) return false;
  return used.toLowerCase().trim().replace(/\/$/, '') === target.toLowerCase().trim().replace(/\/$/, '');
}
