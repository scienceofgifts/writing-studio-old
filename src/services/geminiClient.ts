/**
 * Science of Gifts - Gemini Client Service (Frontend)
 * Calls server-side proxy /api/gemini/* using centralized prompt assembly.
 * Strictly surfaces all errors with visible toasts and explicit throws (no silent fallback).
 */

import {
  AIActionRequest,
  WritingProject,
  OutlineItem,
  OutlineProposal,
  OutlineStructureType,
  EditorialReviewResult,
  ReviewMode,
  ReviewScope,
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
} from '../types/internalLink';
import { storage } from './storage';
import { extractPlainTextFromHtml } from '../utils/richText';
import { extractUrlsFromHtml } from '../utils/urlUtils';
import { assemblePrompt } from './promptAssembly';
import { ModelId, AIActionType } from '../types/models';
import { resolveEffectiveModelId, getModelDefinition } from './modelRegistry';
import {
  IdeaGenerationRequest,
  IdeaGenerationResponse,
} from '../types/ideaGenerator';
import { toast } from './toastService';

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
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error || `Server returned ${res.status}`;
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

      const data = await res.json();
      if (!data.ok) {
        const errorMsg = data.error || 'Failed to execute editorial action.';
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

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
      console.error('Error executing AI action:', err);
      toast.error('AI Request Failed', err?.message || 'Failed to reach editorial service.');
      throw err;
    }
  },

  /**
   * Generate an outline based on project brief, angles, structure type, research, and links
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

    const attachedStudies = storage
      .getResearchStudies()
      .filter((s) => project.attachedStudyIds?.includes(s.id));

    const internalLinks = storage.getInternalLinks();

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

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error || `Server returned ${res.status}`;
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

      const data = await res.json();
      if (!data.ok) {
        const errorMsg = data.error || 'Failed to generate outline.';
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

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
    } catch (err: any) {
      console.error('Error generating outline:', err);
      toast.error('AI Request Failed', err?.message || 'Failed to generate outline.');
      throw err;
    }
  },

  /**
   * Analyze Writing Sample(s) and Extract Reusable Style Directives
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
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error || `Server returned ${res.status}`;
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

      const data = await res.json();
      if (!data.ok) {
        const errorMsg = data.error || 'Failed to analyze style samples.';
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

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
      toast.error('AI Request Failed', err?.message || 'Failed to analyze writing sample style.');
      throw err;
    }
  },

  /**
   * Find Editorial Internal Link Opportunities
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
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error || `Server returned ${res.status}`;
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

      const data = await res.json();
      if (!data.ok) {
        const errorMsg = data.error || 'Failed to analyze link opportunities.';
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

      return {
        ok: true,
        opportunities: data.opportunities || [],
        rationale: data.rationale || 'Editorial link suggestions identified.',
      };
    } catch (err: any) {
      console.error('Error finding link opportunities:', err);
      toast.error('AI Request Failed', err?.message || 'Failed to analyze link opportunities.');
      throw err;
    }
  },

  /**
   * Run AI Editorial Review on document, section, or selection
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
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error || `Server returned ${res.status}`;
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

      const data = await res.json();
      if (!data.ok) {
        const errorMsg = data.error || 'Failed to conduct editorial review.';
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

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
      toast.error('AI Request Failed', err?.message || 'Failed to conduct editorial review.');
      throw err;
    }
  },

  /**
   * Run Quality Control Engine (Deterministic local checks + AI-assisted contextual audit)
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
      const deterministic = runDeterministicQC(project);
      let combinedFindings: QCFinding[] = [...deterministic.findings];
      const categoryChecks = [...deterministic.categoryChecks];

      if (options.enableAiChecks !== false) {
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

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          const errorMsg = errorData.error || `Server returned ${res.status}`;
          toast.error('AI Request Failed', errorMsg);
          throw new Error(errorMsg);
        }

        const data = await res.json();
        if (!data.ok) {
          const errorMsg = data.error || 'Failed to complete Quality Control audit.';
          toast.error('AI Request Failed', errorMsg);
          throw new Error(errorMsg);
        }

        const aiFindings: QCFinding[] = data.findings || [];
        combinedFindings = [...combinedFindings, ...aiFindings];

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
      toast.error('AI Request Failed', err?.message || 'Failed to execute Quality Control audit.');
      throw err;
    }
  },

  /**
   * Generate 8-12 editorial ideas for a topic
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
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error || `Server returned ${res.status}`;
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

      const data = await res.json();
      if (!data.ok) {
        const errorMsg = data.error || 'Failed to generate ideas.';
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

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
      toast.error('AI Request Failed', err?.message || 'Could not generate ideas. Try again or choose another model.');
      throw err;
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
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error || `Server returned ${res.status}`;
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

      const data = await res.json();
      if (!data.ok) {
        const errorMsg = data.error || 'Failed to generate editorial angles.';
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

      return {
        ok: Boolean(data.ok),
        angles: data.angles || [],
        modelUsed: data.modelUsed || effectiveModel,
        durationMs: data.durationMs,
      };
    } catch (err: any) {
      console.error('Error generating editorial angles:', err);
      toast.error('AI Request Failed', err?.message || 'Could not generate editorial angles.');
      throw err;
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

    const attachedStudies = (project.attachedStudyIds || [])
      .map((id) => storage.getResearchStudy(id))
      .filter(Boolean);

    const internalLinks = storage.getInternalLinks();

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
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.error || `Server returned ${res.status}`;
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

      const data = await res.json();
      if (!data.ok) {
        const errorMsg = data.error || 'Failed to synthesize editorial brief.';
        toast.error('AI Request Failed', errorMsg);
        throw new Error(errorMsg);
      }

      return {
        ok: Boolean(data.ok),
        brief: data.brief,
        modelUsed: data.modelUsed || effectiveModel,
        durationMs: data.durationMs,
      };
    } catch (err: any) {
      console.error('Error creating editorial brief:', err);
      toast.error('AI Request Failed', err?.message || 'Could not synthesize editorial brief.');
      throw err;
    }
  },
};
