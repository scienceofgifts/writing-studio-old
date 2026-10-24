/**
 * Science of Gifts - Editorial Writing Studio
 * Shared Data Model & Types (Phase 2)
 */

import { LinkOpportunity } from './internalLink';
import {
  GiftProduct,
  GiftGuideMetadata,
  GuideFAQItem,
  GiftGuideSettings,
  ProductSectionFormat,
} from './giftGuide';

import { ModelId, AIRequestMetadata, AIActionType } from './models';
import { ProjectVersionSnapshot } from './versionHistory';

import { EditorialIdea } from './ideaGenerator';
import { CitationRecommendation, CitedStudyReference } from './citation';
export * from './giftGuide';
export * from './models';
export * from './versionHistory';
export * from './citation';

export type ProjectType = 'article' | 'gift_guide' | 'product_copy';

export type ProjectStatus = 'draft' | 'in_progress' | 'review' | 'complete';

export type ActivePanel =
  | 'brief'
  | 'outline'
  | 'controls'
  | 'rules'
  | 'instructions'
  | 'links'
  | 'citations'
  | 'review'
  | 'qc'
  | 'history'
  | 'research'
  | 'develop'
  | 'draft_package'
  | null;

export type ToneSetting =
  | 'editorial'
  | 'conversational'
  | 'informative'
  | 'sophisticated'
  | 'witty'
  | 'neutral';

export type DetailSetting = 'concise' | 'balanced' | 'detailed';

export type MarketingSetting = 'minimal' | 'moderate' | 'strong';

export type HistoricalSetting = 'none' | 'light' | 'moderate' | 'deep';

export type AudienceSetting = 'general' | 'enthusiast' | 'expert';

export interface WritingControls {
  tone: ToneSetting;
  detail: DetailSetting;
  marketing: MarketingSetting;
  historicalContext: HistoricalSetting;
  audience: AudienceSetting;
  wordCountTarget: string; // e.g. "1,200 - 1,500 words" or "1500"
}

// Alias for backwards compatibility
export type AISettings = WritingControls;

export interface ProjectBrief {
  purpose: string;
  audience: string;
  readerLearns: string;
  readerFeels: string;
  readerAction: string;
  keyPoints: string[];
  thingsToAvoid: string[];
}

export type OutlineStructureType = 'essay' | 'standard_article' | 'guide' | 'custom';

export interface OutlineItemInternalLink {
  id?: string;
  title: string;
  url: string;
  targetAnchor?: string;
  relevanceReason?: string;
}

export interface OutlineItem {
  id: string;
  title: string; // Step title or section label (e.g., "1. Opening Observation" or "The Physics of Heirloom Joinery")
  heading?: string; // Optional conventional H2/H3 heading (optional in Essay mode)
  description?: string; // Optional description
  purpose?: string; // Purpose: what this section/step establishes or achieves
  mainIdea?: string; // Main idea / intellectual argument of this part
  develops?: string; // What this part develops / progression in the argument
  assignedStudyIds?: string[]; // Research studies assigned to this section
  assignedClaims?: string[]; // Specific claims or empirical data points assigned
  assignedInternalLinks?: OutlineItemInternalLink[]; // Internal links recommended for this section
  notes?: string; // Important editorial notes, tone precautions, things to avoid
  completed?: boolean;
}

export interface OutlineProposal {
  items: OutlineItem[];
  rationale?: string;
  structureType?: OutlineStructureType;
}

export interface OutlineStudioMetadata {
  structureType: OutlineStructureType;
  customStructureNotes?: string;
  editorialRationale?: string;
  generatedAt?: string;
}

export interface ContentRule {
  id: string;
  rule: string;
  enabled: boolean;
  isCustom?: boolean;
}

export interface GlobalInstruction {
  id: string;
  text: string;
  category: 'style' | 'constraint' | 'voice' | 'factuality';
  enabled: boolean;
  _isDeleted?: boolean;
  deletedAt?: string;
}

export * from './giftGuide';

export interface ArticleAuthor {
  name: string;
  role?: string;
  bio?: string;
  email?: string;
}

export interface ArticleHeroImage {
  url: string;
  altText: string;
  caption?: string;
  credit?: string;
}

export interface ArticleRelatedContent {
  title: string;
  url: string;
  reason?: string;
}

export interface ArticleMetadata {
  slug: string;
  seoTitle: string;
  metaDescription: string;
  standfirst: string; // Deck / standfirst
  category?: string;
  author?: ArticleAuthor;
  heroImage?: ArticleHeroImage;
  targetKeyword: string;
  secondaryKeywords: string[];
  audience: string;
  searchIntent: string;
  tags?: string[];
  sources?: string[];
  relatedContent?: ArticleRelatedContent[];
  publishedAt?: string;
}

// =========================================================================
// EDITORIAL DEVELOPMENT WORKFLOW (Idea -> Angles -> Direction -> Brief)
// =========================================================================

export type AngleRole =
  | 'primary'
  | 'secondary'
  | 'brief_mention'
  | 'do_not_use'
  | 'unassigned';

export interface EditorialAngle {
  id: string;
  title: string;
  coreArgument: string;
  whyInteresting: string;
  whatArticleEmphasizes: string;
  possibleTakeaway: string;
  role: AngleRole;
}

export interface EditorialDirection {
  primaryAngleId?: string;
  secondaryAngleId?: string;
  briefMentionAngleIds: string[];
  doNotUseAngleIds: string[];
  editorsDirection: string;
}

export interface BriefReference {
  studyId?: string;
  title: string;
  authors: string[];
  publication?: string;
  publicationYear?: string;
  doiOrUrl?: string;
  isVerifiedMatch: boolean;
  verificationNote?: string;
}

export interface StructuredEditorialBrief {
  workingTitle: string;
  topic: string;
  audience: string;
  searchIntent: string;
  primaryAngle: string;
  secondaryFocus: string;
  briefMentions: string[];
  thingsToAvoid: string[];
  centralArgument: string;
  keyQuestions: string[];
  editorialDirection: string;
  suggestedTakeaway: string;
  factualContext: string[]; // Clearly distinguished factual / research findings
  editorialInterpretation: string[]; // Clearly distinguished editorial synthesis
  internalLinkOpportunities: string[];
  references?: BriefReference[];
  styleConsiderations?: string;
  generatedAt?: string;
  updatedAt?: string;
}

export interface EditorialDevelopment {
  originalIdea?: EditorialIdea;
  angles: EditorialAngle[];
  direction: EditorialDirection;
  brief?: StructuredEditorialBrief;
  status: 'idea' | 'angles_generated' | 'direction_set' | 'brief_ready' | 'outline_ready' | 'draft_package_ready';
  lastGeneratedAt?: string;
}

export interface ProductPositioning {
  whatMakesItInteresting?: string;
  whyWouldSomeoneWantIt?: string;
  suitedRecipient?: string;
  whatToEmphasize?: string;
  whatToAvoid?: string;
  keySellingAngle?: string;
  emotionalAngle?: string;
  historicalAngle?: string;
}

export interface ProductCopyVariants {
  formalEditorial?: string;
  emotionalStorytelling?: string;
  conciseConversion?: string;
  technicalHistorical?: string;
}

export interface ProductCopyMetadata {
  // Product Information (Structured Facts)
  productName: string;
  productType: string;
  productUrl: string;
  imageUrl?: string;
  rawProductInfo: string;
  designDescription?: string;
  designDetails?: string;
  designConcept?: string;
  historicalContext?: string;
  materials?: string;
  features?: string;
  dimensions?: string;
  colors?: string;
  intendedRecipient?: string;
  targetAudience?: string;
  productNotes?: string;
  additionalFacts?: string;

  // Product Positioning
  positioning?: ProductPositioning;

  // Dedicated Generated Copy Fields
  productTitle?: string;
  headline?: string;
  standfirst?: string;
  description?: string;
  bestFor?: string;
  keyFeaturesBullets?: string[];
  historicalAngleCopy?: string;
  materialsCraftNote?: string;
  callToAction?: string;
  shortCopySocial?: string;
  ecommerceBullets?: string[];

  // Multi-Variant Copy
  variants?: ProductCopyVariants;

  // SEO Metadata
  slug?: string;
  seoTitle?: string;
  metaDescription?: string;
  primaryKeyword?: string;
  secondaryKeywords?: string[];
}

export type ReviewCategory =
  | 'ai_language'
  | 'repetition'
  | 'clarity'
  | 'flow'
  | 'tone_style'
  | 'content_rules'
  | 'unsupported_claims'
  | 'seo'
  | 'internal_links';

export type ReviewMode =
  | 'full'
  | 'overall'
  | 'style'
  | 'clarity_flow'
  | 'repetition'
  | 'ai_language'
  | 'unsupported_claims'
  | 'seo'
  | 'rules';

export type ReviewScope = 'all' | 'selection' | 'section';

export type ReviewSeverity = 'critical' | 'important' | 'minor' | 'suggestion';

export type ReviewFindingStatus = 'pending' | 'accepted' | 'rejected' | 'stale';

export type ReviewFindingLocationType =
  | 'paragraph'
  | 'sentence'
  | 'heading'
  | 'product_section'
  | 'field'
  | 'document';

export interface ReviewFindingLocation {
  type: ReviewFindingLocationType;
  description?: string;
  targetOutlineId?: string;
  productId?: string;
  field?: string;
}

export interface ReviewFinding {
  id: string;
  category: ReviewCategory;
  severity: ReviewSeverity;
  location: ReviewFindingLocation;
  originalText?: string;
  explanation: string;
  suggestedAction: string;
  proposedText?: string;
  status: ReviewFindingStatus;
  ruleId?: string;
  isRuleViolation?: boolean;
  createdAt?: string;
}

export interface EditorialReviewResult {
  id: string;
  reviewedAt: string;
  scope: ReviewScope;
  selectedText?: string;
  targetSectionId?: string;
  mode: ReviewMode;
  qualitativeSummary: string;
  counts: {
    critical: number;
    important: number;
    minor: number;
    suggestion: number;
  };
  findings: ReviewFinding[];
}

export type QCOverallStatus = 'ready' | 'warning' | 'action_required';

export type QCSeverity = 'critical' | 'warning' | 'suggestion';

export type QCCategory =
  | 'completeness'
  | 'outline'
  | 'word_count'
  | 'content_rules'
  | 'em_dash'
  | 'forbidden_phrases'
  | 'ai_patterns'
  | 'repetition'
  | 'factual_consistency'
  | 'product_data'
  | 'seo'
  | 'urls'
  | 'links'
  | 'style_profile';

export type QCCheckStatus = 'passed' | 'warning' | 'failed' | 'not_applicable';

export interface QCCategoryCheck {
  category: QCCategory;
  label: string;
  status: QCCheckStatus;
  message: string;
  issueCount: number;
}

export interface QCFinding {
  id: string;
  category: QCCategory;
  severity: QCSeverity;
  title: string;
  location: string;
  explanation: string;
  suggestedAction?: string;
  targetText?: string;
  proposedText?: string;
  isFactualContradiction?: boolean;
  isFactualUnsupported?: boolean;
  isRuleViolation?: boolean;
  isStale?: boolean;
}

export interface QCResult {
  id: string;
  runAt: string;
  documentLengthAtRun: number;
  status: QCOverallStatus;
  summary: string;
  counts: {
    critical: number;
    warning: number;
    suggestion: number;
  };
  categoryChecks: QCCategoryCheck[];
  findings: QCFinding[];
  isStale?: boolean;
}

export interface WritingProject {
  id: string;
  type: ProjectType;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: ProjectStatus;
  content: string; // Structured rich-text HTML representation
  projectInstructions: string;
  brief: ProjectBrief;
  outline: OutlineItem[];
  contentRules: ContentRule[];
  writingControls: WritingControls;
  aiSettings: WritingControls; // Kept in sync for backward compatibility
  styleProfileId?: string; // Optional applied Style Profile ID (Phase 3)
  linkOpportunities?: LinkOpportunity[]; // Editorial internal link recommendations (Phase 4)
  editorialReview?: EditorialReviewResult; // AI Editorial Review findings (Phase 7)
  qualityControl?: QCResult; // Quality Control verification result (Phase 8)
  modelOverride?: ModelId; // Project-level AI model override (Phase 9)
  versionHistory?: ProjectVersionSnapshot[]; // Full structured version history (Phase 9)
  lastAIRequest?: AIRequestMetadata; // Request transparency metadata (Phase 9)
  articleMeta?: ArticleMetadata;
  giftGuideMeta?: GiftGuideMetadata;
  productCopyMeta?: ProductCopyMetadata;
  attachedStudyIds?: string[]; // Attached research studies for this project
  selectedClaimIds?: string[]; // Specifically chosen claims for editorial use
  citationRecommendations?: CitationRecommendation[]; // Research citation recommendations
  citedStudies?: CitedStudyReference[]; // Sources currently cited in the article text with active numbering
  editorialDevelopment?: EditorialDevelopment; // Editorial development workflow (Idea -> Angles -> Direction -> Brief)
  outlineStructure?: OutlineStructureType; // Applied structure type (essay, standard_article, guide, custom)
  outlineRationale?: string; // Editorial rationale for this outline progression
  outlineMetadata?: OutlineStudioMetadata; // Additional Outline Studio metadata
  cloudRevision?: number; // Monotonically increasing server revision number
  baseCloudRevision?: number; // Last cloud revision this local copy was based on
  lastSyncedAt?: string; // Timestamp of last confirmed cloud sync
  lastSyncedUserId?: string; // UID of the account that last synced this record
  _hasLocalUnsyncedSave?: boolean; // True when a local save occurred since last cloud sync
  _isSeedProject?: boolean; // True for unmodified default seed projects
  _isDeleted?: boolean;
  deletedAt?: string;
}

export type SaveStatus =
  | 'unsaved'
  | 'saving_local'
  | 'saved_local'
  | 'saving_cloud'
  | 'saved_cloud'
  | 'cloud_error'
  | 'conflict';

export interface ProjectConflictInfo {
  projectId: string;
  localWorkingProject: WritingProject;
  remoteProject: WritingProject;
  baseRevision: number;
  remoteRevision: number;
  detectedAt: string;
}

export interface DiffProposal {
  id: string;
  scopeDescription: string;
  actionLabel?: string;
  targetText: string;
  proposedText: string;
  explanation: string;
  modelUsed?: ModelId;
  range?: {
    start: number;
    end: number;
  };
  mode?: 'replace_selection' | 'insert' | 'replace_all';
}

export interface AIActionRequest {
  action: string;
  actionType?: AIActionType;
  modelOverride?: ModelId;
  projectType: ProjectType;
  projectTitle: string;
  currentContent: string;
  selectedText?: string;
  scope: 'selection' | 'paragraph' | 'section' | 'all';
  customCommand?: string;
  globalInstructions: string[];
  projectInstructions: string;
  brief?: ProjectBrief;
  outline?: OutlineItem[];
  contentRules?: string[];
  writingControls?: WritingControls;
  aiSettings?: WritingControls;
  styleProfileId?: string;
  styleProfileName?: string;
  styleProfileInstructions?: string[];
  metadata?: Record<string, any>;
  relevantProduct?: GiftProduct | Partial<ProductCopyMetadata>;
  targetOutlineItem?: OutlineItem;
}
