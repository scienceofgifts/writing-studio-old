/**
 * Science of Gifts - Version History Service (Phase 9)
 * Handles structured snapshot creation, retention management, version restoration, and editorial diffing.
 */

import { WritingProject } from '../types/project';
import {
  ProjectVersionSnapshot,
  VersionType,
  StructuredProjectState,
  VersionDiffResult,
} from '../types/versionHistory';
import { countWords, extractPlainTextFromHtml } from '../utils/richText';
import { ModelId } from '../types/models';

const MAX_INLINE_VERSION_COUNT = 25;

/**
 * Extracts structured project state for snapshotting
 */
export function extractStructuredState(project: WritingProject): StructuredProjectState {
  return {
    title: project.title,
    projectType: project.type,
    brief: project.brief ? JSON.parse(JSON.stringify(project.brief)) : undefined,
    outline: project.outline ? JSON.parse(JSON.stringify(project.outline)) : undefined,
    contentRules: project.contentRules ? JSON.parse(JSON.stringify(project.contentRules)) : undefined,
    writingControls: project.writingControls ? JSON.parse(JSON.stringify(project.writingControls)) : undefined,
    styleProfileId: project.styleProfileId,
    articleMeta: project.articleMeta ? JSON.parse(JSON.stringify(project.articleMeta)) : undefined,
    giftGuideMeta: project.giftGuideMeta ? JSON.parse(JSON.stringify(project.giftGuideMeta)) : undefined,
    productCopyMeta: project.productCopyMeta ? JSON.parse(JSON.stringify(project.productCopyMeta)) : undefined,
  };
}

/**
 * Merges two or more arrays of version snapshots without losing entries.
 * Deduplicates by id (or identical timestamp+content+type) and assigns consistent sequential versionNumbers if needed.
 */
export function mergeVersionHistories(
  ...histories: (ProjectVersionSnapshot[] | undefined)[]
): ProjectVersionSnapshot[] {
  const byId = new Map<string, ProjectVersionSnapshot>();
  for (const list of histories) {
    if (!Array.isArray(list)) continue;
    for (const snap of list) {
      if (!snap || !snap.id) continue;
      const existing = byId.get(snap.id);
      if (!existing) {
        byId.set(snap.id, snap);
      } else {
        // Keep favorite flag or fuller fields if one was updated
        byId.set(snap.id, {
          ...existing,
          ...snap,
          isFavorite: existing.isFavorite || snap.isFavorite,
        });
      }
    }
  }

  const all = Array.from(byId.values());
  // Sort oldest to newest first so we can ensure strictly monotonic versionNumbers if any collided across devices
  all.sort((a, b) => {
    const tA = new Date(a.timestamp || 0).getTime();
    const tB = new Date(b.timestamp || 0).getTime();
    if (tA !== tB) return tA - tB;
    return (a.versionNumber || 0) - (b.versionNumber || 0);
  });

  let highestVer = 0;
  const normalized = all.map((snap) => {
    const vNum = Math.max(highestVer + 1, snap.versionNumber || 1);
    highestVer = vNum;
    return {
      ...snap,
      versionNumber: vNum,
    };
  });

  // Return newest first
  return normalized.sort((a, b) => b.versionNumber - a.versionNumber);
}

/**
 * Trims inline project history to keep main Firestore project document well under the 1 MiB limit,
 * while all snapshots remain in the dedicated project_history IndexedDB store and Firestore history subcollection.
 */
export function trimInlineVersionHistory(history: ProjectVersionSnapshot[]): ProjectVersionSnapshot[] {
  if (history.length <= MAX_INLINE_VERSION_COUNT) {
    return history;
  }
  const favorites = history.filter((v) => v.isFavorite);
  const others = history.filter((v) => !v.isFavorite);
  const keepCount = Math.max(5, MAX_INLINE_VERSION_COUNT - favorites.length);
  const kept = [...favorites, ...others.slice(0, keepCount)];
  return kept.sort((a, b) => b.versionNumber - a.versionNumber);
}

/**
 * Creates a new version snapshot and returns the updated version history array
 */
export function createVersionSnapshot(
  project: WritingProject,
  type: VersionType,
  options?: {
    label?: string;
    modelUsed?: ModelId;
    actionDescription?: string;
    force?: boolean;
    cloudRevision?: number;
    snapshotId?: string;
  }
): ProjectVersionSnapshot[] {
  const existingHistory = project.versionHistory || [];
  const content = project.content || '<p></p>';
  const plainText = extractPlainTextFromHtml(content);
  const words = countWords(content);
  const chars = plainText.length;
  const structuredState = extractStructuredState(project);

  // Deduplication check: if latest version has identical content and structured state, skip unless forced
  if (existingHistory.length > 0 && !options?.force) {
    const latest = existingHistory[0];
    if (
      latest.content.trim() === content.trim() &&
      JSON.stringify(latest.structuredState) === JSON.stringify(structuredState) &&
      (latest.type === type || type === 'manual_save')
    ) {
      return existingHistory;
    }
  }

  const maxExistingNumber = existingHistory.reduce(
    (max, v) => Math.max(max, v.versionNumber || 0),
    0
  );
  const nextVersionNumber = maxExistingNumber + 1;

  const newSnapshot: ProjectVersionSnapshot = {
    id: options?.snapshotId || `ver-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    versionNumber: nextVersionNumber,
    projectId: project.id,
    type,
    label: options?.label?.trim() || getDefaultVersionLabel(type, options?.actionDescription),
    timestamp: new Date().toISOString(),
    wordCount: words,
    characterCount: chars,
    content,
    structuredState,
    cloudRevision: options?.cloudRevision,
    modelUsed: options?.modelUsed,
    actionDescription: options?.actionDescription,
  };

  const updatedHistory = [newSnapshot, ...existingHistory];
  return trimInlineVersionHistory(updatedHistory);
}

/**
 * Restores a selected version snapshot into the project.
 * Automatically saves a checkpoint of current document before restoring,
 * then marks the restored version as a new current version.
 */
export function restoreVersionSnapshot(
  project: WritingProject,
  targetVersionId: string,
  externalHistory?: ProjectVersionSnapshot[]
): { updatedProject: WritingProject; restoredVersion: ProjectVersionSnapshot; newSnapshots: ProjectVersionSnapshot[] } | null {
  const history = mergeVersionHistories(project.versionHistory, externalHistory);
  const targetVersion = history.find((v) => v.id === targetVersionId);
  if (!targetVersion) return null;

  const projectWithMergedHistory: WritingProject = {
    ...project,
    versionHistory: history,
  };

  // 1. Create a checkpoint of the current document before restoring (if it differs from latest snapshot)
  const historyWithCurrentCheckpoint = createVersionSnapshot(projectWithMergedHistory, 'manual_save', {
    label: `Before restoring Version ${targetVersion.versionNumber}`,
    actionDescription: `Auto-checkpoint prior to Version ${targetVersion.versionNumber} restore`,
    force: false,
  });

  const newSnapshots: ProjectVersionSnapshot[] = [];
  if (
    historyWithCurrentCheckpoint.length > 0 &&
    (!history[0] || historyWithCurrentCheckpoint[0].id !== history[0].id)
  ) {
    newSnapshots.push(historyWithCurrentCheckpoint[0]);
  }

  // 2. Prepare restored project state
  const restoredState = targetVersion.structuredState;
  const maxVer = historyWithCurrentCheckpoint.reduce((m, v) => Math.max(m, v.versionNumber || 0), 0);
  const nextVersionNumber = maxVer + 1;

  const restoredCheckpoint: ProjectVersionSnapshot = {
    id: `ver-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    versionNumber: nextVersionNumber,
    projectId: project.id,
    type: 'restored_version',
    label: `Restored Version ${targetVersion.versionNumber}${targetVersion.label ? ` ("${targetVersion.label}")` : ''}`,
    timestamp: new Date().toISOString(),
    wordCount: targetVersion.wordCount,
    characterCount: targetVersion.characterCount,
    content: targetVersion.content,
    structuredState: restoredState,
    basedOnVersionId: targetVersion.id,
    actionDescription: `Restored from Version ${targetVersion.versionNumber}`,
  };

  newSnapshots.unshift(restoredCheckpoint);

  const combinedHistory = [restoredCheckpoint, ...historyWithCurrentCheckpoint];

  const updatedProject: WritingProject = {
    ...project,
    title: restoredState.title || project.title,
    content: targetVersion.content,
    brief: restoredState.brief || project.brief,
    outline: restoredState.outline || project.outline,
    contentRules: restoredState.contentRules || project.contentRules,
    writingControls: restoredState.writingControls || project.writingControls,
    styleProfileId: restoredState.styleProfileId ?? project.styleProfileId,
    articleMeta: restoredState.articleMeta || project.articleMeta,
    giftGuideMeta: restoredState.giftGuideMeta || project.giftGuideMeta,
    productCopyMeta: restoredState.productCopyMeta || project.productCopyMeta,
    versionHistory: trimInlineVersionHistory(combinedHistory),
    updatedAt: new Date().toISOString(),
  };

  return { updatedProject, restoredVersion: targetVersion, newSnapshots };
}

/**
 * Formats a clean human label for different version types
 */
function getDefaultVersionLabel(type: VersionType, actionDescription?: string): string {
  if (actionDescription) return actionDescription;
  switch (type) {
    case 'manual_save':
      return 'Saved Version';
    case 'autosave_snapshot':
      return 'Autosave Snapshot';
    case 'before_ai_edit':
      return 'Before AI Edit';
    case 'after_ai_edit':
      return 'After AI Edit';
    case 'before_review':
      return 'Before Editorial Review';
    case 'before_qc':
      return 'Before Quality Control';
    case 'restored_version':
      return 'Restored Version';
    case 'conflict_backup':
      return 'Conflict Backup';
    default:
      return 'Snapshot';
  }
}

/**
 * Editorial-grade text diffing between current content and a previous version.
 * Operates on paragraphs and word tokens without markdown or HTML leakage.
 */
export function computeVersionDiff(
  currentHtml: string,
  targetHtml: string,
  targetVersionId: string
): VersionDiffResult {
  const currentText = extractPlainTextFromHtml(currentHtml || '');
  const targetText = extractPlainTextFromHtml(targetHtml || '');

  const currentParas = currentText.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  const targetParas = targetText.split(/\n+/).map((p) => p.trim()).filter(Boolean);

  let additionsCount = 0;
  let deletionsCount = 0;
  let unchangedCount = 0;

  const diffParagraphs: VersionDiffResult['diffParagraphs'] = [];

  const maxLen = Math.max(currentParas.length, targetParas.length);

  for (let i = 0; i < maxLen; i++) {
    const curP = currentParas[i];
    const tgtP = targetParas[i];

    if (curP && !tgtP) {
      // Added in current
      additionsCount++;
      diffParagraphs.push({
        type: 'added',
        text: curP,
        diffSegments: [{ type: 'added', value: curP }],
      });
    } else if (!curP && tgtP) {
      // Removed in current (was in target)
      deletionsCount++;
      diffParagraphs.push({
        type: 'removed',
        text: tgtP,
        diffSegments: [{ type: 'removed', value: tgtP }],
      });
    } else if (curP === tgtP) {
      // Exact match
      unchangedCount++;
      diffParagraphs.push({
        type: 'unchanged',
        text: curP,
        diffSegments: [{ type: 'unchanged', value: curP }],
      });
    } else {
      // Modified paragraph: compute word-level diff
      const curWords = curP.split(/\s+/);
      const tgtWords = tgtP.split(/\s+/);

      const segments: { type: 'added' | 'removed' | 'unchanged'; value: string }[] = [];
      
      // Simple word alignment for clean visual comparison
      const minW = Math.min(curWords.length, tgtWords.length);
      for (let w = 0; w < minW; w++) {
        if (curWords[w] === tgtWords[w]) {
          segments.push({ type: 'unchanged', value: curWords[w] + ' ' });
        } else {
          segments.push({ type: 'removed', value: tgtWords[w] + ' ' });
          segments.push({ type: 'added', value: curWords[w] + ' ' });
          deletionsCount++;
          additionsCount++;
        }
      }
      if (curWords.length > minW) {
        const extraCur = curWords.slice(minW).join(' ');
        segments.push({ type: 'added', value: extraCur });
        additionsCount++;
      }
      if (tgtWords.length > minW) {
        const extraTgt = tgtWords.slice(minW).join(' ');
        segments.push({ type: 'removed', value: extraTgt });
        deletionsCount++;
      }

      diffParagraphs.push({
        type: 'modified',
        text: curP,
        originalText: tgtP,
        diffSegments: segments,
      });
    }
  }

  return {
    comparedVersionId: targetVersionId,
    additionsCount,
    deletionsCount,
    unchangedCount,
    diffParagraphs,
  };
}
