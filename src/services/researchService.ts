/**
 * Science of Gifts - Research & Fact Engine Service
 * Handles metadata lookup, PDF text extraction, AI study analysis,
 * structured claims management, research-driven idea generation, and editorial packaging.
 * Explicitly surfaces all errors with visible toasts and throws (no silent fallback).
 */

import {
  ResearchStudy,
  StudyAnalysis,
  ResearchClaim,
  EditorialDraftPackage,
  PotentialArticleIdea,
} from '../types/research';
import { WritingProject, OutlineItem } from '../types/project';
import { CitationRecommendation, FindCitationsResponse, ResearchGap } from '../types/citation';
import { splitBodyAndReferences, extractCitationsFromHtml } from '../utils/citationUtils';
import { extractPlainTextFromHtml } from '../utils/richText';
import { resolveEffectiveModelId } from './modelRegistry';
import { storage } from './storage';
import { ModelId } from '../types/models';
import { getApiUrl } from './apiConfig';
import { toast } from './toastService';

export interface MetadataLookupResult {
  success: boolean;
  title?: string;
  authors?: string[];
  publication?: string;
  publicationYear?: string | number;
  doi?: string;
  url?: string;
  abstract?: string;
  error?: string;
}

export interface PdfExtractionResult {
  success: boolean;
  text?: string;
  numPages?: number;
  fileName?: string;
  fileSize?: number;
  isScannedOrEmpty?: boolean;
  error?: string;
}

export class ResearchService {
  /**
   * Retrieves academic metadata from a DOI, PubMed URL, journal URL, or publication link.
   */
  public async lookupMetadata(input: string): Promise<MetadataLookupResult> {
    const trimmed = input.trim();
    if (!trimmed) {
      toast.error('API Error', 'DOI or URL cannot be empty.');
      throw new Error('DOI or URL cannot be empty.');
    }

    try {
      const response = await fetch(getApiUrl('/api/research/lookup-metadata'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: trimmed }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMessage = errData.error || `Server returned ${response.status}`;
        toast.error('API Error', errMessage);
        throw new Error(errMessage);
      }

      const data = await response.json();
      if (!data.success && !data.ok) {
        const errMessage = data.error || 'Failed to lookup metadata';
        toast.error('API Error', errMessage);
        throw new Error(errMessage);
      }

      return data;
    } catch (err: any) {
      console.error('Metadata lookup failed:', err);
      toast.error('API Error', err?.message || 'Failed to lookup metadata.');
      throw err;
    }
  }

  /**
   * Uploads and extracts usable text from an academic research PDF.
   */
  public async extractPdf(file: File): Promise<PdfExtractionResult> {
    try {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);

      const response = await fetch(getApiUrl('/api/research/extract-pdf'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdfBase64: base64,
          fileName: file.name,
          fileSize: file.size,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMessage = errData.error || `Server returned ${response.status}`;
        toast.error('API Error', errMessage);
        throw new Error(errMessage);
      }

      const data = await response.json();
      if (!data.success && !data.ok) {
        const errMessage = data.error || 'Failed to extract text from PDF';
        toast.error('API Error', errMessage);
        throw new Error(errMessage);
      }

      return data;
    } catch (err: any) {
      console.error('PDF extraction failed:', err);
      toast.error('API Error', err?.message || 'Failed to extract text from PDF.');
      throw err;
    }
  }

  /**
   * Analyzes a research study using Gemini with strict editorial fact-integrity.
   * Produces structured analysis and creates traceable claims.
   */
  public async analyzeStudy(
    study: ResearchStudy,
    modelOverride?: ModelId
  ): Promise<{ analysis: StudyAnalysis; claims: ResearchClaim[] }> {
    const activeModel = modelOverride || storage.getGlobalModel();

    try {
      const response = await fetch(getApiUrl('/api/gemini/analyze-study'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          study,
          modelOverride: activeModel,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMessage = errData.error || `Server returned ${response.status}`;
        toast.error('API Error', errMessage);
        throw new Error(errMessage);
      }

      const result = await response.json();
      if (!result.ok || !result.analysis) {
        const errMessage = result.error || 'Failed to analyze study.';
        toast.error('API Error', errMessage);
        throw new Error(errMessage);
      }

      return {
        analysis: result.analysis,
        claims: result.claims || [],
      };
    } catch (err: any) {
      console.error('Error analyzing study:', err);
      toast.error('API Error', err?.message || 'Failed to analyze study.');
      throw err;
    }
  }

  /**
   * Generates high-intent article concepts from selected research studies.
   */
  public async generateIdeasFromResearch(
    studies: ResearchStudy[],
    modelOverride?: ModelId
  ): Promise<PotentialArticleIdea[]> {
    if (studies.length === 0) return [];
    const activeModel = modelOverride || storage.getGlobalModel();

    try {
      const response = await fetch(getApiUrl('/api/gemini/research-ideas'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studies,
          modelOverride: activeModel,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMessage = errData.error || `Server returned ${response.status}`;
        toast.error('API Error', errMessage);
        throw new Error(errMessage);
      }

      const result = await response.json();
      if (!result.ok || !Array.isArray(result.ideas)) {
        const errMessage = result.error || 'Failed to generate ideas from research.';
        toast.error('API Error', errMessage);
        throw new Error(errMessage);
      }

      return result.ideas;
    } catch (err: any) {
      console.error('Error generating ideas from research:', err);
      toast.error('API Error', err?.message || 'Failed to generate ideas from research.');
      throw err;
    }
  }

  /**
   * Generates a research-informed outline assigning studies to specific sections.
   */
  public async buildResearchOutline(
    project: WritingProject,
    attachedStudies: ResearchStudy[],
    selectedClaims: ResearchClaim[],
    modelOverride?: ModelId
  ): Promise<{ outline: OutlineItem[]; rationale: string }> {
    const activeModel = modelOverride || project.modelOverride || storage.getGlobalModel();

    try {
      const response = await fetch(getApiUrl('/api/gemini/research-outline'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project,
          attachedStudies,
          selectedClaims,
          modelOverride: activeModel,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMessage = errData.error || `Server returned ${response.status}`;
        toast.error('API Error', errMessage);
        throw new Error(errMessage);
      }

      const result = await response.json();
      if (!result.ok || !Array.isArray(result.outline)) {
        const errMessage = result.error || 'Failed to build research outline.';
        toast.error('API Error', errMessage);
        throw new Error(errMessage);
      }

      return {
        outline: result.outline,
        rationale: result.rationale || 'Built structured outline incorporating attached research.',
      };
    } catch (err: any) {
      console.error('Error building research outline:', err);
      toast.error('API Error', err?.message || 'Failed to build research outline.');
      throw err;
    }
  }

  /**
   * Prepares an exportable, self-contained Editorial Package ready for handoff or publishing.
   */
  public prepareEditorialPackage(
    project: WritingProject,
    attachedStudies: ResearchStudy[],
    claims: ResearchClaim[],
    internalLinks: any[] = []
  ): EditorialDraftPackage {
    const nowIso = new Date().toISOString();

    const sections = (project.outline || []).map((sec) => {
      const studiesForSection = (sec.assignedStudyIds || [])
        .map((id) => attachedStudies.find((s) => s.id === id))
        .filter(Boolean) as ResearchStudy[];

      return {
        title: sec.title,
        description: sec.description,
        notes: sec.notes,
        assignedStudies: studiesForSection.map((s) => ({
          id: s.id,
          title: s.title,
          citation: `${s.authors?.[0] || 'Unknown'} (${s.publicationYear || 'n.d.'})`,
        })),
      };
    });

    const researchPackage = attachedStudies.map((study) => {
      const studyClaims = claims.filter((c) => c.studyId === study.id);
      return {
        studyId: study.id,
        title: study.title,
        citation: `${study.authors?.[0] || 'Unknown'} (${study.publicationYear || 'n.d.'}), ${study.publication || ''}`,
        keyFindings: study.analysis?.whatTheStudyFound || study.keyFindings || [],
        supportedClaims: studyClaims.map((c) => ({
          text: c.claimText,
          type: c.claimType,
          confidence: c.confidence,
          limitation: c.relevantLimitation,
        })),
        limitations: study.analysis?.limitations || [],
        articleRelevance: study.analysis?.whatItMeans || study.summary || '',
      };
    });

    const cleanLinks = internalLinks.slice(0, 5).map((l) => ({
      targetTitle: l.title || l.anchorText,
      url: l.targetUrl || l.url,
      suggestedAnchor: l.anchorText || l.title,
      relevantSection: l.category || 'General',
      reason: l.context || 'Editorial link opportunity',
    }));

    let md = `# EDITORIAL DRAFT PACKAGE: ${project.title.toUpperCase()}\n\n`;
    md += `*Generated: ${new Date().toLocaleDateString()} | Science of Gifts Editorial Studio*\n\n`;
    md += `---\n\n`;

    md += `## 1. PROJECT BRIEF & STRATEGIC INTENT\n`;
    md += `- **Purpose**: ${project.brief?.purpose || 'Editorial exploration'}\n`;
    md += `- **Audience**: ${project.brief?.audience || 'Discerning readers'}\n`;
    md += `- **Target Reader Takeaway**: ${project.brief?.readerLearns || 'Material permanence & craft appreciation'}\n`;
    md += `- **Search Intent**: ${project.articleMeta?.searchIntent || 'Psychological & Cultural insight'}\n\n`;

    md += `## 2. RESEARCH-BACKED CONTENT OUTLINE\n`;
    sections.forEach((s, idx) => {
      md += `### ${idx + 1}. ${s.title}\n`;
      if (s.description) md += `*${s.description}*\n`;
      if (s.assignedStudies.length > 0) {
        md += `**Empirical Studies Assigned:**\n`;
        s.assignedStudies.forEach((as) => {
          md += `- ${as.title} (${as.citation})\n`;
        });
      }
      md += `\n`;
    });

    md += `## 3. RESEARCH REPOSITORY & VERIFIED CLAIMS\n`;
    researchPackage.forEach((r) => {
      md += `### Study: ${r.title}\n`;
      md += `*Citation: ${r.citation}*\n\n`;
      md += `**Key Findings:**\n`;
      r.keyFindings.forEach((kf) => (md += `- ${kf}\n`));
      md += `\n**Verified Editorial Claims:**\n`;
      r.supportedClaims.forEach((sc) => {
        md += `- [${sc.type.toUpperCase()}] "${sc.text}" (Confidence: ${sc.confidence})${sc.limitation ? ` *[Limitation: ${sc.limitation}]*` : ''}\n`;
      });
      md += `\n`;
    });

    md += `## 4. INTERNAL LINK RECOMMENDATIONS\n`;
    cleanLinks.forEach((l) => {
      md += `- **[${l.suggestedAnchor}](${l.url})**: ${l.targetTitle} (${l.reason})\n`;
    });

    return {
      generatedAt: nowIso,
      article: {
        title: project.title,
        type: project.type,
        searchIntent: project.articleMeta?.searchIntent || 'Editorial insight',
        audience: project.brief?.audience || 'Discerning readers',
        purpose: project.brief?.purpose,
        readerLearns: project.brief?.readerLearns,
        readerFeels: project.brief?.readerFeels,
        keyPoints: project.brief?.keyPoints,
        thingsToAvoid: project.brief?.thingsToAvoid,
      },
      outline: { sections },
      research: researchPackage,
      internalLinks: cleanLinks,
      editorialNotes: {
        pointsToEmphasize: ['Bench-made durability', 'Daily ritual engagement', 'Honest patina'],
        thingsToAvoid: ['Disposable gadgets', 'Superficial status branding', 'Gimmicky unboxing'],
        unresolvedQuestions: ['Multi-decade longitudinal attachment beyond 36 months'],
      },
      markdownExport: md,
    };
  }

  /**
   * Discovers empirical research citation opportunities in the article draft
   * and matches claims to studies in the Science of Gifts Research Library.
   */
  public async findCitationOpportunities(
    project: WritingProject,
    allStudies?: ResearchStudy[],
    options: { modelOverride?: ModelId } = {}
  ): Promise<FindCitationsResponse> {
    const studies = allStudies || storage.getResearchStudies();
    const effectiveModel = resolveEffectiveModelId({
      actionOverride: options.modelOverride,
      projectOverride: project.modelOverride,
      globalDefault: storage.getGlobalModel(),
    });

    const { bodyHtml } = splitBodyAndReferences(project.content || '');
    const plainDoc = extractPlainTextFromHtml(bodyHtml);

    if (!plainDoc || plainDoc.trim().length === 0) {
      return {
        ok: true,
        recommendations: [],
        gaps: [],
        rationale: 'Article is currently empty. Write or draft content to discover citation opportunities.',
      };
    }

    if (!studies || studies.length === 0) {
      return {
        ok: true,
        recommendations: [],
        gaps: [
          {
            claimInArticle: 'General draft content',
            topicNeeded: 'Gift psychology, material durability, recipient attachment',
            suggestion: 'Add empirical studies to the Research Library to enable in-text citations.',
          },
        ],
        rationale: 'No research studies found in the library. Upload or analyze studies first.',
      };
    }

    const existingCitations = extractCitationsFromHtml(project.content || '');
    const existingStudyIds = new Set(existingCitations.map((c) => c.studyId));

    try {
      const response = await fetch(getApiUrl('/api/gemini/find-citations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectTitle: project.title,
          documentContent: plainDoc,
          studies: studies.map((s) => ({
            id: s.id,
            title: s.title,
            authors: s.authors,
            publicationYear: s.publicationYear,
            publication: s.publication || s.sourceOrPublisher,
            doi: s.doi,
            url: s.sourceUrl || s.doiOrUrl,
            claims: (s.claims || []).map((c) => ({
              text: c.claimText,
              type: c.claimType,
              confidence: c.confidence,
              source: c.supportedBySource,
            })),
            keyFindings: s.analysis?.whatTheStudyFound || s.keyFindings || [],
            whatWasStudied: s.analysis?.whatWasStudied || '',
            whatItMeans: s.analysis?.whatItMeans || '',
            methodology: s.analysis?.methodology || s.methodology || '',
          })),
          existingCitedStudyIds: Array.from(existingStudyIds),
          model: effectiveModel,
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        const errMessage = errData.error || `Server returned ${response.status}`;
        toast.error('API Error', errMessage);
        throw new Error(errMessage);
      }

      const data = await response.json();
      if (!data.ok || !Array.isArray(data.recommendations)) {
        const errMessage = data.error || 'Failed to find citation opportunities.';
        toast.error('API Error', errMessage);
        throw new Error(errMessage);
      }

      const enriched: CitationRecommendation[] = data.recommendations.map(
        (rec: any, idx: number) => {
          const study = studies.find((s) => s.id === rec.studyId);
          const isAlreadyCited = existingStudyIds.has(rec.studyId);
          return {
            id: rec.id || `cit-opp-${Date.now()}-${idx}`,
            studyId: rec.studyId,
            studyTitle: study?.title || rec.studyTitle || 'Research Study',
            authors: study?.authors || rec.authors || ['Research Archive'],
            publicationYear: study?.publicationYear || rec.publicationYear,
            publication: study?.publication || study?.sourceOrPublisher,
            doi: study?.doi,
            url: study?.sourceUrl || study?.doiOrUrl,
            targetPassage: rec.targetPassage,
            proposedCitationNumber:
              rec.proposedCitationNumber || existingStudyIds.size + idx + 1,
            relevantFinding:
              rec.relevantFinding ||
              study?.analysis?.whatTheStudyFound?.[0] ||
              'Empirical finding aligns with claim.',
            explanation:
              rec.explanation ||
              `Substantiates the article's observation regarding ${
                study?.title || 'gift psychology'
              }.`,
            confidence: rec.confidence || 'verified_empirical',
            isVerifiedMatch: rec.isVerifiedMatch !== false,
            status: isAlreadyCited ? 'accepted' : 'pending',
            createdAt: new Date().toISOString(),
          };
        }
      );

      return {
        ok: true,
        recommendations: enriched,
        gaps: data.gaps || [],
        rationale: data.rationale || 'Discovered research citations.',
      };
    } catch (err: any) {
      console.error('Error finding citations:', err);
      toast.error('API Error', err?.message || 'Failed to find citations.');
      throw err;
    }
  }
}

export const researchService = new ResearchService();
