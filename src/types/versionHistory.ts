/**
 * Science of Gifts - Version History Types (Phase 9)
 * Editorial CMS-grade revision history with full structured content preservation.
 */

import {
  ProjectType,
  ProjectBrief,
  OutlineItem,
  ContentRule,
  WritingControls,
  ArticleMetadata,
  GiftGuideMetadata,
  ProductCopyMetadata,
} from './project';
import { ModelId } from './models';

export type VersionType =
  | 'manual_save'
  | 'autosave_snapshot'
  | 'before_ai_edit'
  | 'after_ai_edit'
  | 'before_review'
  | 'before_qc'
  | 'restored_version'
  | 'conflict_backup';

export interface StructuredProjectState {
  title: string;
  projectType: ProjectType;
  brief?: ProjectBrief;
  outline?: OutlineItem[];
  contentRules?: ContentRule[];
  writingControls?: WritingControls;
  styleProfileId?: string;
  articleMeta?: ArticleMetadata;
  giftGuideMeta?: GiftGuideMetadata;
  productCopyMeta?: ProductCopyMetadata;
}

export interface ProjectVersionSnapshot {
  id: string;
  versionNumber: number;
  projectId: string;
  type: VersionType;
  label?: string;
  timestamp: string;
  wordCount: number;
  characterCount: number;
  content: string; // Preserves complete structured semantic HTML
  structuredState: StructuredProjectState;
  basedOnVersionId?: string;
  cloudRevision?: number;
  modelUsed?: ModelId;
  actionDescription?: string;
  isFavorite?: boolean;
}

export interface VersionDiffResult {
  currentVersionId?: string;
  comparedVersionId: string;
  additionsCount: number;
  deletionsCount: number;
  unchangedCount: number;
  diffParagraphs: {
    type: 'added' | 'removed' | 'unchanged' | 'modified';
    text: string;
    originalText?: string;
    diffSegments?: {
      type: 'added' | 'removed' | 'unchanged';
      value: string;
    }[];
  }[];
}
