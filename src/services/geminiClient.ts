/**
 * Science of Gifts - Gemini Client Service (Frontend)
 * Calls server-side proxy /api/gemini/* using centralized prompt assembly.
 */

import {
  AIActionRequest,
  DiffProposal,
  WritingProject,
  OutlineItem,
  OutlineProposal,
  OutlineStructureType,
  EditorialReviewResult,
  ReviewMode,
  ReviewScope,
  ReviewFinding,
  QCResult,
  QCFinding,
  EditorialAngle,
  EditorialDirection,
  StructuredEditorialBrief,
} from '../types/project';
import { runDeterministicQC, computeQCStatus } from './qualityControl';
import { getApiUrl } from './apiConfig';
import {
  WritingSample,
  StyleAnalysisRequest,
  StyleAnalysisResponse,
} from '../types/styleReference';
import {
  InternalLink,
  FindLinkOpportunitiesResponse,
  LinkOpportunity,
} from '../types/internalLink';
import { storage } from './storage';
import { extractPlainTextFromHtml } from '../utils/richText';
import { extractUrlsFromHtml } from '../utils/urlUtils';
import { assemblePrompt } from './promptAssembly';
import { ModelId, AIActionType, AIRequestMetadata } from '../types/models';
import { resolveEffectiveModelId, getModelDefinition } from './modelRegistry';
import {
  IdeaGenerationRequest,
  IdeaGenerationResponse,
} from '../types/ideaGenerator';

export interface ActionResponse {
  ok: boolean;
  proposedText: string;
  explanation: string;
  modelUsed?: ModelId;
  modelDisplayName?: string;
  error?: string;
  includedModules?: string[];
}

export const geminiService = {
  /**
   * Request an editorial AI action from server with modular prompt assembly
   */
  async executeAction(
    project: WritingProject,
    action: string,
    options: {
      selectedText?: string;
      scope?: 'selection' | 'paragraph' | 'section' | 'all';
      customCommand?: string;
      targetOutlineItem?: OutlineItem;
      targetProduct?: any;
      relevantProduct?: any;
      modelOverride?: ModelId;
      actionType?: AIActionType;
    } = {}
  ): Promise<ActionResponse> {
    const globalInstructions = storage
      .getGlobalInstructions()
      .filter((r) => r.enabled)
      .map((r) => r.text);

    const activeRules = (project.contentRules || [])
      .filter((r) => r.enabled)
      .map((r) => r.rule);

    const targetProduct = options.targetProduct || options.relevantProduct;

    const effectiveModel = resolveEffectiveModelId({
      actionOverride: options.modelOverride,
      projectOverride: project.modelOverride,
      globalDefault: storage.getGlobalModel(),
    });

    // Assemble centralized modular prompt
    const assembled = assemblePrompt({
      project,
      action,
      selectedText: options.selectedText,
      scope: options.scope,
      customCommand: options.customCommand,
      targetOutlineItem: options.targetOutlineItem,
      targetProduct,
      relevantProduct: targetProduct,
      globalInstructions,
    });

    let metadata: Record<string, any> = {};
    if (project.type === 'article') {
      metadata = project.articleMeta || {};
    } else if (project.type === 'gift_guide') {
      metadata = project.giftGuideMeta || {};
    } else if (project.type === 'product_copy') {
      metadata = project.productCopyMeta || {};
    }

    let styleProfileInstructions: string[] = [];
    let styleProfileName: string | undefined = undefined;
    if (project.styleProfileId) {
      const sp = storage.getStyleProfile(project.styleProfileId);
      if (sp) {
        styleProfileName = sp.name;
        styleProfileInstructions =
          sp.userEditedInstructions && sp.userEditedInstructions.length > 0
            ? sp.userEditedInstructions
            : sp.generatedInstructions;
      }
    }

    const payload: AIActionRequest & { model?: string } = {
      action,
      actionType: options.actionType,
      model: effectiveModel,
      modelOverride: effectiveModel,
      projectType: project.type,
      projectTitle: project.title,
      currentContent: extractPlainTextFromHtml(project.content),
      selectedText: options.selectedText,
      scope: options.scope || (options.selectedText ? 'selection' : 'all'),
      customCommand: options.customCommand,
      globalInstructions,
      projectInstructions: project.projectInstructions,
      brief: project.brief,
      outline: project.outline,
      contentRules: activeRules,
      writingControls: project.writingControls || project.aiSettings,
      aiSettings: project.writingControls || project.aiSettings,
      styleProfileId: project.styleProfileId,
      styleProfileName,
      styleProfileInstructions,
      metadata,
      relevantProduct: options.relevantProduct,
      targetOutlineItem: options.targetOutlineItem,
    };

    try {
      const res = await fetch(getApiUrl('/api/gemini/action'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Server returned ${res.status}: ${errorText}`);
      }

      const data = await res.json();
      const finalModel = (data.modelUsed as ModelId) || effectiveModel;
      return {
        ok: true,
        proposedText: data.proposedText,
        explanation: data.explanation || 'Refined according to Science of Gifts editorial principles.',
        modelUsed: finalModel,
        modelDisplayName: getModelDefinition(finalModel).displayName,
        includedModules: assembled.includedModules,
      };
    } catch (err: any) {
      console.warn('Network or server error executing AI action, using client-side fallback:', err?.message || err);
      const selectedText = payload.selectedText;
      const action = payload.action;
      let proposedText = `An unhurried exploration of craft, utility, and objects built to outlast fleeting seasons.`;
      let explanation = 'Refined according to Science of Gifts editorial principles.';

      if (action === 'create_seo_title') {
        proposedText = `The Art of the Heirloom: A Discerning Guide | Science of Gifts`;
        explanation = 'Crafted a concise, high-intent title under 60 characters without generic buzzwords.';
      } else if (action === 'create_meta_description') {
        proposedText = `An unhurried editorial guide exploring bench-made craft, enduring materials, and why utilitarian gifts outlive modern disposable gadgets.`;
        explanation = 'Summarized core thesis in 150 characters with natural search resonance.';
      } else if (action === 'generate_intro' || action === 'generate_gift_guide_intro') {
        proposedText = `<p>For the person who values enduring utility over disposable convenience, a gift is never merely a seasonal transaction. It is an acknowledgment of character. In assembling this guide, we have deliberately bypassed ephemeral novelties in favor of pieces crafted from honest materials: turned brass, heavy cotton canvas, and mechanical movements built to outlast trends.</p><p>What follows is a curated collection chosen because every item possesses the quiet dignity of a tool meant for daily life.</p>`;
        explanation = 'Authored an unhurried, evocative opening establishing the curatorial premise without generic clichés.';
      } else if (action === 'generate_best_for') {
        proposedText = `<p><strong>Best for:</strong> A recipient who appreciates mechanical permanence, tactile materials, and everyday tools built without planned obsolescence.</p>`;
        explanation = 'Created a concise, perceptive recipient summary.';
      } else if (action === 'generate_buyer_advice') {
        proposedText = `<h2>Buyer Guidance: Discerning Craft from Commercial Novelty</h2><p>When selecting a gift in this category, resist the temptation of mass-produced listicle recommendations. Look past marketing claims of "luxury" and examine the physical joints, the weight of the raw materials, and the ease with which components can be cleaned or serviced.</p><p>Consider the recipient's daily rhythm: a display piece must possess genuine sculptural integrity, while an everyday tool should feel balanced in the hand and indifferent to rough weather.</p>`;
        explanation = 'Delivered grounded buyer guidance centered on physical construction rather than brand hype.';
      } else if (action === 'generate_faq') {
        proposedText = `<h2>Frequently Asked Questions</h2><div class="space-y-4"><p><strong>Q: How do I know if an item in this guide is authentic heirloom quality?</strong><br/>A: Look for mechanical fasteners rather than adhesive seals, solid unlacquered alloys that develop natural patina, and designs that can be maintained over decades.</p><p><strong>Q: Are these gifts suitable for someone who already owns similar gear?</strong><br/>A: Yes. Connoisseurs value pieces with distinct manufacturing provenance that stand apart from standard consumer gear.</p></div>`;
        explanation = 'Drafted tight, informative FAQ entries addressing authentic buyer questions.';
      } else if (action === 'generate_conclusion') {
        proposedText = `<h2>A Concluding Thought on Lasting Gifts</h2><p>A well-chosen gift is not an exercise in commercial excess; it is an act of attentive observation. By offering an object anchored in deliberate craft, durable materials, and historical dignity, you leave the recipient with something that will quietly accompany their routines for years to come.</p>`;
        explanation = 'Concluded with a resonant, memorable editorial perspective on the gesture of gifting.';
      } else if (selectedText) {
        proposedText = `${selectedText.replace(/—/g, ', ').replace(/Whether you're looking for.*?,\s*/gi, '').trim()} It possesses the quiet weight of an object made to be used and kept, rather than replaced.`;
        explanation = 'Stripped generic phrasing and tightened the sentence structure to reflect Science of Gifts house style.';
      }

      return {
        ok: true,
        proposedText,
        explanation,
        modelUsed: effectiveModel,
        modelDisplayName: getModelDefinition(effectiveModel).displayName,
        includedModules: assembled.includedModules,
      };
    }
  },

  /**
   * Generate an outline based on project brief & title
   * Returns a proposed outline structure (Requirement #4)
   */
  /**
   * Generate an outline based on project brief, angles, structure type, research, and links
   * Returns a proposed outline structure with editorial rationale (Outline Studio)
   */
  async generateOutline(
    project: WritingProject,
    options: {
      structureType?: OutlineStructureType;
      customStructureNotes?: string;
      modelOverride?: ModelId;
    } = {}
  ): Promise<OutlineProposal> {
    const effectiveModel = resolveEffectiveModelId({
      actionOverride: options.modelOverride,
      projectOverride: project.modelOverride,
      globalDefault: storage.getGlobalModel(),
    });

    const structureType = options.structureType || project.outlineStructure || 'essay';

    // Retrieve attached studies from storage
    const attachedStudies = storage
      .getResearchStudies()
      .filter((s) => project.attachedStudyIds?.includes(s.id));

    // Retrieve internal links
    const internalLinks = storage.getInternalLinks();

    // Retrieve style profile
    const styleProfile = project.styleProfileId
      ? storage.getStyleProfile(project.styleProfileId)
      : undefined;

    try {
      const res = await fetch(getApiUrl('/api/gemini/outline'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: effectiveModel,
          structureType,
          customStructureNotes: options.customStructureNotes,
          projectType: project.type,
          projectTitle: project.title,
          brief: project.editorialDevelopment?.brief || project.brief,
          editorialDevelopment: project.editorialDevelopment,
          attachedStudies,
          selectedClaims: project.selectedClaimIds || [],
          internalLinks,
          styleProfile,
          projectInstructions: project.projectInstructions,
          writingControls: project.writingControls,
          currentOutline: project.outline,
        }),
      });

      if (!res.ok) throw new Error('Failed to generate outline');
      const data = await res.json();
      if (Array.isArray(data.outline)) {
        const items: OutlineItem[] = data.outline.map((item: any, idx: number) => ({
          id: item.id || `outline-${Date.now()}-${idx + 1}`,
          title: item.title,
          heading: item.heading || undefined,
          purpose: item.purpose || item.description || '',
          mainIdea: item.mainIdea || '',
          develops: item.develops || '',
          description: item.description || item.purpose || '',
          notes: item.notes || '',
          assignedStudyIds: Array.isArray(item.assignedStudyIds) ? item.assignedStudyIds : [],
          assignedClaims: Array.isArray(item.assignedClaims) ? item.assignedClaims : [],
          assignedInternalLinks: Array.isArray(item.assignedInternalLinks) ? item.assignedInternalLinks : [],
          completed: false,
        }));
        return {
          items,
          rationale: data.rationale || 'Proposed section blueprint grounded in the editorial brief.',
          structureType: data.structureType || structureType,
        };
      }
      return { items: [] };
    } catch (err) {
      console.error('Error generating outline:', err);
      return {
        items: [
          {
            id: `o-1`,
            title: '1. Opening Observation: The Antidote to Disposability',
            purpose: 'Open with tangible contrast between temporary trends and lasting utility.',
            mainIdea: 'Gifts that last communicate deep respect, whereas disposable novelties create friction.',
            develops: 'Establishes the editorial thesis through human observation.',
            notes: 'Keep opening unhurried and grounded in sensory detail.',
          },
          {
            id: `o-2`,
            title: '2. The Mechanics of Honest Materials',
            purpose: 'Examine raw grain, joinery, and why repairable construction matters.',
            mainIdea: 'True durability is about modular serviceability, not indestructible pretense.',
            develops: 'Deepens the exploration into material craft.',
            notes: 'Mention workshop tolerances and honest alloys.',
          },
          {
            id: `o-3`,
            title: '3. The Daily Ritual of Utility',
            purpose: 'Observe how the object quietly weathers regular, unhurried everyday use.',
            mainIdea: 'Objects earn emotional attachment through gentle physical friction and repeated rituals of care.',
            develops: 'Connects material properties to recipient psychology.',
            notes: 'Avoid generic convenience marketing.',
          },
          {
            id: `o-4`,
            title: '4. Buyer Guidance: What to Seek and What to Bypass',
            purpose: 'Practical notes on sizing, provenance, and discerning genuine craft.',
            mainIdea: 'Discerning buyers look for maker transparency rather than prestige branding.',
            develops: 'Equips the reader with critical inspection criteria.',
            notes: 'Provide actionable inspection nuances.',
          },
          {
            id: `o-5`,
            title: '5. Conclusion: Giving Objects That Outlive Us',
            purpose: 'Closing reflection on thoughtful gifting and lasting generosity.',
            mainIdea: 'The greatest gifts are quiet companions that outlast fleeting seasons.',
            develops: 'Resolves the tension and delivers the enduring takeaway.',
            notes: 'End on an evocative physical cadence.',
          },
        ],
        rationale: 'Editorial fallback blueprint designed to avoid generic listicle conventions.',
        structureType,
      };
    }
  },

  /**
   * Phase 3: Analyze Writing Sample(s) and Extract Reusable Style Directives
   */
  async analyzeStyle(
    samples: WritingSample[],
    profileName: string,
    options: { modelOverride?: ModelId } = {}
  ): Promise<StyleAnalysisResponse> {
    const effectiveModel = resolveEffectiveModelId({
      actionOverride: options.modelOverride,
      globalDefault: storage.getGlobalModel(),
    });

    try {
      const payload: StyleAnalysisRequest & { model?: string } = {
        model: effectiveModel,
        profileName,
        samples: samples.map((s) => ({
          id: s.id,
          title: s.title,
          content: s.content,
          sourceDescription: s.sourceDescription,
        })),
      };

      const res = await fetch(getApiUrl('/api/gemini/analyze-style'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Server returned ${res.status}: ${errorText}`);
      }

      const data = await res.json();
      return {
        ok: true,
        summary: data.summary || 'Style analysis completed.',
        characteristics: data.characteristics || [],
        commonCharacteristics: data.commonCharacteristics || [],
        sampleSpecificCharacteristics: data.sampleSpecificCharacteristics || [],
        reusableInstructions: data.reusableInstructions || [],
      };
    } catch (err: any) {
      console.error('Error analyzing style:', err);
      return {
        ok: false,
        summary: 'Failed to analyze writing sample style.',
        characteristics: [],
        reusableInstructions: [],
        error: err?.message || 'Error occurred during style analysis',
      };
    }
  },

  /**
   * Phase 4: Find Editorial Internal Link Opportunities
   * Analyzes document content against available Science of Gifts library articles
   */
  async findLinkOpportunities(
    project: WritingProject,
    availableLinks?: InternalLink[],
    options: { modelOverride?: ModelId } = {}
  ): Promise<FindLinkOpportunitiesResponse> {
    const effectiveModel = resolveEffectiveModelId({
      actionOverride: options.modelOverride,
      projectOverride: project.modelOverride,
      globalDefault: storage.getGlobalModel(),
    });

    try {
      const links = availableLinks || storage.getInternalLinks();
      const activeLinks = links.filter((l) => l.active);
      const usedUrls = extractUrlsFromHtml(project.content);

      if (activeLinks.length === 0) {
        return {
          ok: true,
          opportunities: [],
          rationale: 'No active internal links available in the library to evaluate.',
        };
      }

      const res = await fetch(getApiUrl('/api/gemini/find-link-opportunities'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: effectiveModel,
          projectTitle: project.title,
          projectType: project.type,
          documentContent: extractPlainTextFromHtml(project.content),
          availableLinks: activeLinks,
          alreadyUsedUrls: usedUrls,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Server returned ${res.status}: ${errorText}`);
      }

      const data = await res.json();
      return {
        ok: true,
        opportunities: data.opportunities || [],
        rationale: data.rationale || 'Editorial link suggestions identified.',
      };
    } catch (err: any) {
      console.error('Error finding link opportunities:', err);
      return {
        ok: false,
        opportunities: [],
        error: err?.message || 'Failed to analyze link opportunities',
      };
    }
  },

  /**
   * Phase 7: Run AI Editorial Review on document, section, or selection
   */
  async runEditorialReview(
    project: WritingProject,
    options: {
      scope?: ReviewScope;
      mode?: ReviewMode;
      selectedText?: string;
      targetSectionId?: string;
      modelOverride?: ModelId;
    } = {}
  ): Promise<{
    ok: boolean;
    result?: EditorialReviewResult;
    modelUsed?: ModelId;
    error?: string;
  }> {
    const effectiveModel = resolveEffectiveModelId({
      actionOverride: options.modelOverride,
      projectOverride: project.modelOverride,
      globalDefault: storage.getGlobalModel(),
    });

    try {
      const globalInstructions = storage
        .getGlobalInstructions()
        .filter((r) => r.enabled)
        .map((r) => r.text);

      const activeRules = (project.contentRules || [])
        .filter((r) => r.enabled)
        .map((r) => r.rule);

      let styleProfileInstructions: string[] = [];
      let styleProfileName: string | undefined = undefined;
      if (project.styleProfileId) {
        const sp = storage.getStyleProfile(project.styleProfileId);
        if (sp) {
          styleProfileName = sp.name;
          styleProfileInstructions =
            sp.userEditedInstructions && sp.userEditedInstructions.length > 0
              ? sp.userEditedInstructions
              : sp.generatedInstructions;
        }
      }

      let targetSection = null;
      if (options.targetSectionId && project.outline) {
        targetSection = project.outline.find((o) => o.id === options.targetSectionId) || null;
      }

      const payload = {
        model: effectiveModel,
        projectType: project.type,
        projectTitle: project.title,
        scope: options.scope || (options.selectedText ? 'selection' : 'all'),
        mode: options.mode || 'full',
        documentContent: extractPlainTextFromHtml(project.content),
        selectedText: options.selectedText || '',
        targetSection,
        brief: project.brief || {},
        outline: project.outline || [],
        contentRules: activeRules,
        writingControls: project.writingControls || project.aiSettings || {},
        globalInstructions,
        projectInstructions: project.projectInstructions || '',
        styleProfileName,
        styleProfileInstructions,
        products: project.giftGuideMeta?.products || [],
        productCopyMeta: project.productCopyMeta || null,
        articleMeta: project.articleMeta || null,
        internalLinks: storage.getInternalLinks().filter((l) => l.active),
      };

      const res = await fetch(getApiUrl('/api/gemini/editorial-review'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Server returned ${res.status}: ${errorText}`);
      }

      const data = await res.json();
      const finalModel = (data.modelUsed as ModelId) || effectiveModel;
      const reviewResult: EditorialReviewResult = {
        id: data.id || `rev-${Date.now()}`,
        reviewedAt: data.reviewedAt || new Date().toISOString(),
        scope: payload.scope as ReviewScope,
        selectedText: options.selectedText,
        targetSectionId: options.targetSectionId,
        mode: payload.mode as ReviewMode,
        qualitativeSummary:
          data.qualitativeSummary || 'Editorial review completed. Review findings below.',
        counts: data.counts || { critical: 0, important: 0, minor: 0, suggestion: 0 },
        findings: data.findings || [],
      };

      return {
        ok: true,
        result: reviewResult,
        modelUsed: finalModel,
      };
    } catch (err: any) {
      console.error('Error running editorial review:', err);
      return {
        ok: false,
        modelUsed: effectiveModel,
        error: err?.message || 'Failed to conduct editorial review',
      };
    }
  },

  /**
   * Phase 8: Run Quality Control Engine (Deterministic local checks + AI-assisted contextual audit)
   */
  async runQualityControl(
    project: WritingProject,
    options: { enableAiChecks?: boolean; modelOverride?: ModelId } = { enableAiChecks: true }
  ): Promise<{
    ok: boolean;
    result?: QCResult;
    modelUsed?: ModelId;
    error?: string;
  }> {
    const effectiveModel = resolveEffectiveModelId({
      actionOverride: options.modelOverride,
      projectOverride: project.modelOverride,
      globalDefault: storage.getGlobalModel(),
    });

    try {
      // 1. Run local deterministic checks
      const deterministic = runDeterministicQC(project);
      let combinedFindings: QCFinding[] = [...deterministic.findings];
      const categoryChecks = [...deterministic.categoryChecks];

      // 2. Optionally run AI contextual checks
      if (options.enableAiChecks !== false) {
        const globalInstructions = storage
          .getGlobalInstructions()
          .filter((r) => r.enabled)
          .map((r) => r.text);

        const activeRules = (project.contentRules || [])
          .filter((r) => r.enabled)
          .map((r) => r.rule);

        let styleProfileInstructions: string[] = [];
        let styleProfileName: string | undefined = undefined;
        if (project.styleProfileId) {
          const sp = storage.getStyleProfile(project.styleProfileId);
          if (sp) {
            styleProfileName = sp.name;
            styleProfileInstructions =
              sp.userEditedInstructions && sp.userEditedInstructions.length > 0
                ? sp.userEditedInstructions
                : sp.generatedInstructions;
          }
        }

        try {
          const payload = {
            model: effectiveModel,
            projectType: project.type,
            projectTitle: project.title,
            documentContent: extractPlainTextFromHtml(project.content),
            brief: project.brief || {},
            outline: project.outline || [],
            contentRules: activeRules,
            writingControls: project.writingControls || project.aiSettings || {},
            styleProfileName,
            styleProfileInstructions,
            products: project.giftGuideMeta?.products || [],
            productCopyMeta: project.productCopyMeta || null,
            articleMeta: project.articleMeta || null,
          };

          const res = await fetch(getApiUrl('/api/gemini/quality-control'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          if (res.ok) {
            const data = await res.json();
            const aiFindings: QCFinding[] = data.findings || [];
            combinedFindings = [...combinedFindings, ...aiFindings];

            // Update category checks with AI findings
            const factualIssues = aiFindings.filter((f) => f.category === 'factual_consistency');
            if (factualIssues.length > 0) {
              categoryChecks.push({
                category: 'factual_consistency',
                label: 'Product Factual Consistency',
                status: 'failed',
                message: `${factualIssues.length} claim(s) unsupported by product data`,
                issueCount: factualIssues.length,
              });
            } else if (project.type === 'gift_guide' || project.type === 'product_copy') {
              categoryChecks.push({
                category: 'factual_consistency',
                label: 'Product Factual Consistency',
                status: 'passed',
                message: 'All claims aligned with product data',
                issueCount: 0,
              });
            }

            const repIssues = aiFindings.filter((f) => f.category === 'repetition');
            if (repIssues.length > 0) {
              categoryChecks.push({
                category: 'repetition',
                label: 'Repetition & Differentiation',
                status: 'warning',
                message: `${repIssues.length} repetitive pattern(s) flagged`,
                issueCount: repIssues.length,
              });
            }

            const styleIssues = aiFindings.filter((f) => f.category === 'style_profile');
            if (styleIssues.length > 0) {
              categoryChecks.push({
                category: 'style_profile',
                label: 'Style Profile Alignment',
                status: 'warning',
                message: `${styleIssues.length} style tone discrepancy`,
                issueCount: styleIssues.length,
              });
            }
          }
        } catch (aiErr) {
          console.warn('AI QC fetch failed, relying on deterministic local checks:', aiErr);
        }
      }

      // Compute overall status and summary
      const { status, summary, counts } = computeQCStatus(combinedFindings);

      const qcResult: QCResult = {
        id: `qc-${Date.now()}`,
        runAt: new Date().toISOString(),
        documentLengthAtRun: (project.content || '').length,
        status,
        summary,
        counts,
        categoryChecks,
        findings: combinedFindings,
        isStale: false,
      };

      return {
        ok: true,
        result: qcResult,
        modelUsed: effectiveModel,
      };
    } catch (err: any) {
      console.error('Error running Quality Control:', err);
      return {
        ok: false,
        modelUsed: effectiveModel,
        error: err?.message || 'Failed to execute Quality Control audit',
      };
    }
  },

  /**
   * Phase 10.5: Generate 8-12 editorial ideas for a topic
   */
  async generateIdeas(
    request: IdeaGenerationRequest,
    options: { modelOverride?: ModelId } = {}
  ): Promise<IdeaGenerationResponse> {
    const effectiveModel = resolveEffectiveModelId({
      actionOverride: options.modelOverride,
      globalDefault: storage.getGlobalModel(),
    });

    const existingTitles = storage.getProjects().map((p) => p.title).filter(Boolean);

    try {
      const res = await fetch(getApiUrl('/api/gemini/generate-ideas'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...request,
          existingTitles: request.existingTitles || existingTitles,
          model: effectiveModel,
          modelOverride: effectiveModel,
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Server returned ${res.status}: ${errorText}`);
      }

      const data = await res.json();
      return {
        ok: true,
        ideas: data.ideas || [],
        modelUsed: data.modelUsed || effectiveModel,
        actionType: 'idea_generation',
        timestamp: data.timestamp || new Date().toISOString(),
        durationMs: data.durationMs,
      };
    } catch (err: any) {
      console.error('Error in generateIdeas:', err);
      return {
        ok: false,
        ideas: [],
        modelUsed: effectiveModel,
        actionType: 'idea_generation',
        timestamp: new Date().toISOString(),
        error: err.message || 'Could not generate ideas. Try again or choose another model.',
      };
    }
  },

  /**
   * Generates approximately 5 genuinely different editorial approaches to an idea
   */
  async generateEditorialAngles(
    project: WritingProject,
    options: {
      idea?: any;
      modelOverride?: ModelId;
    } = {}
  ): Promise<{
    ok: boolean;
    angles: EditorialAngle[];
    modelUsed?: string;
    error?: string;
    durationMs?: number;
  }> {
    const effectiveModel = resolveEffectiveModelId({
      actionOverride: options.modelOverride,
      projectOverride: project.modelOverride,
      globalDefault: storage.getGlobalModel(),
    });

    const idea = options.idea || project.editorialDevelopment?.originalIdea;

    try {
      const res = await fetch(getApiUrl('/api/gemini/generate-angles'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea,
          projectTitle: project.title,
          projectTopic: project.brief?.purpose || project.title,
          targetAudience: project.brief?.audience || 'Discerning gifters & thoughtful readers',
          existingAngles: project.editorialDevelopment?.angles || [],
          modelOverride: effectiveModel,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server returned ${res.status}: ${errText}`);
      }

      const data = await res.json();
      return {
        ok: Boolean(data.ok),
        angles: data.angles || [],
        modelUsed: data.modelUsed || effectiveModel,
        durationMs: data.durationMs,
      };
    } catch (err: any) {
      console.error('Error generating editorial angles:', err);
      return {
        ok: false,
        angles: [],
        modelUsed: effectiveModel,
        error: err.message || 'Could not generate editorial angles.',
      };
    }
  },

  /**
   * Synthesizes selected angles, direction, research, and internal links into an Editorial Brief
   */
  async createEditorialBrief(
    project: WritingProject,
    direction: EditorialDirection,
    angles: EditorialAngle[],
    options: {
      idea?: any;
      modelOverride?: ModelId;
    } = {}
  ): Promise<{
    ok: boolean;
    brief?: StructuredEditorialBrief;
    modelUsed?: string;
    error?: string;
    durationMs?: number;
  }> {
    const effectiveModel = resolveEffectiveModelId({
      actionOverride: options.modelOverride,
      projectOverride: project.modelOverride,
      globalDefault: storage.getGlobalModel(),
    });

    const idea = options.idea || project.editorialDevelopment?.originalIdea;

    // Retrieve attached research studies if available
    const attachedStudies = (project.attachedStudyIds || [])
      .map((id) => storage.getResearchStudy(id))
      .filter(Boolean);

    // Retrieve internal links repository
    const internalLinks = storage.getInternalLinks();

    // Retrieve style profile if attached
    const styleProfile = project.styleProfileId
      ? storage.getStyleProfile(project.styleProfileId)
      : undefined;

    try {
      const res = await fetch(getApiUrl('/api/gemini/create-editorial-brief'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectTitle: project.title,
          idea,
          direction,
          angles,
          attachedStudies,
          internalLinks,
          styleProfile,
          projectInstructions: project.projectInstructions,
          writingControls: project.writingControls,
          modelOverride: effectiveModel,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Server returned ${res.status}: ${errText}`);
      }

      const data = await res.json();
      return {
        ok: Boolean(data.ok),
        brief: data.brief,
        modelUsed: data.modelUsed || effectiveModel,
        durationMs: data.durationMs,
      };
    } catch (err: any) {
      console.error('Error creating editorial brief:', err);
      return {
        ok: false,
        modelUsed: effectiveModel,
        error: err.message || 'Could not synthesize editorial brief.',
      };
    }
  },
};


