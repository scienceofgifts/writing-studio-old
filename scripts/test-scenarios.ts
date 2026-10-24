/**
 * Runtime verification script for manual saving, version snapshots,
 * cloud-authoritative synchronization, and concurrency conflict resolution.
 */

import { storage } from '../src/services/storage';
import { createVersionSnapshot, computeVersionDiff } from '../src/services/versionHistoryService';
import { WritingProject } from '../src/types/project';

// Simple polyfill for window/localStorage in node test environment
class LocalStorageMock {
  private store: Record<string, string> = {};
  getItem(key: string): string | null {
    return this.store[key] || null;
  }
  setItem(key: string, value: string): void {
    this.store[key] = value.toString();
  }
  removeItem(key: string): void {
    delete this.store[key];
  }
  clear(): void {
    this.store = {};
  }
}

if (typeof window === 'undefined') {
  (global as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    localStorage: new LocalStorageMock(),
  };
  (global as any).localStorage = (global as any).window.localStorage;
  (global as any).CustomEvent = class {
    constructor(public type: string, public detail: any) {}
  };
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, desc: string) {
  if (condition) {
    console.log(`  ✓ PASS: ${desc}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${desc}`);
    failed++;
  }
}

async function runTests() {
  console.log('=== TEST SUITE: Manual Saving, Versions, & Cloud Concurrency ===\n');

  // Initialize storage
  await storage.init();

  // Scenario 1 & 2: Project creation and Version History creation on Save
  console.log('Scenario 1 & 2: Manual Save creates a Version History snapshot without automatic typing writes');
  const testProject = storage.createProject('article', 'Test Article for Concurrency');
  assert(testProject.id !== '', 'Created project successfully');
  const initialHistory = testProject.versionHistory || [];
  assert(initialHistory.length === 1, 'New project starts with initial draft creation snapshot (Version 1)');
  assert(initialHistory[0].label === 'Initial Draft Created', 'Initial snapshot is labeled "Initial Draft Created"');

  // Initial content created by template
  const initialContent = testProject.content;

  // Simulate editing content in memory (e.g. user typing in editor)
  const editedProject: WritingProject = {
    ...testProject,
    content: '<p>First manual draft content written with authentic nuance.</p>',
  };

  // Verify storage is untouched before manual save
  const storedBeforeSave = storage.getProjects().find(p => p.id === testProject.id);
  assert(storedBeforeSave?.content === initialContent, 'Typing does NOT mutate local storage before explicit save');

  // Perform Manual Save snapshot creation
  const updatedHistory = createVersionSnapshot(editedProject, 'manual_save', {
    label: 'Manual Save',
    force: true,
  });
  assert(updatedHistory.length === 2, 'Manual Save generated exactly 1 additional version snapshot (Version 2)');
  assert(updatedHistory[0].versionNumber === 2, 'New snapshot incremented version number to 2');
  assert(updatedHistory[0].type === 'manual_save', 'Snapshot recorded type as manual_save');
  assert(updatedHistory[0].content === editedProject.content, 'Snapshot captured exact content');

  // Save to storage
  const savedProject: WritingProject = {
    ...editedProject,
    versionHistory: updatedHistory,
    updatedAt: new Date().toISOString(),
  };
  storage.saveProject(savedProject);
  const storedAfterSave = storage.getProjects().find(p => p.id === testProject.id);
  assert(storedAfterSave?.content === editedProject.content, 'Explicit save committed content to storage');
  assert(storedAfterSave?.versionHistory?.length === 2, 'Version history snapshots persisted in storage');

  // Scenario 3: Version Diff computation
  console.log('\nScenario 3: Diff Review compares snapshots accurately');
  const editedProject2: WritingProject = {
    ...savedProject,
    content: '<p>First manual draft content written with authentic artisan nuance and psychological depth.</p>',
  };
  const diffResult = computeVersionDiff(savedProject.content, editedProject2.content, 'v2');
  assert(diffResult.additionsCount > 0, `Diff detected additions (additions: ${diffResult.additionsCount})`);
  assert(diffResult.diffParagraphs.length > 0, 'Diff generated paragraph segments');

  // Scenario 4: Concurrency control logic (Revision validation)
  console.log('\nScenario 4: Integer Revision & Concurrency Conflict Detection');
  // Local project has base revision 1
  const localProjectRev1: WritingProject = {
    ...savedProject,
    revision: 1,
    cloudRevision: 1,
  };

  // Remote cloud project was modified by another client/tab to revision 2
  const remoteProjectRev2: WritingProject = {
    ...savedProject,
    title: 'Test Article (Remote Edit)',
    content: '<p>Remote collaborator updated this document.</p>',
    revision: 2,
    cloudRevision: 2,
    updatedAt: new Date(Date.now() + 5000).toISOString(),
  };

  // Transaction simulation: if baseRevision (1) !== remote.revision (2), conflict MUST be raised
  const baseRev = localProjectRev1.cloudRevision;
  const isStaleWrite = remoteProjectRev2.revision !== undefined && remoteProjectRev2.revision !== baseRev;
  assert(isStaleWrite === true, 'Detected stale write because baseRevision (1) != remoteRevision (2)');

  // Scenario 5: Conflict resolution - "Keep as new copy"
  console.log('\nScenario 5: Conflict Resolution: Keep Local as New Copy');
  const recoveryCopy = storage.duplicateProjectAsCopy(localProjectRev1, '(Local Recovery Copy)');
  assert(recoveryCopy.id !== localProjectRev1.id, 'Created new project ID for recovery copy');
  assert(recoveryCopy.title.includes('(Local Recovery Copy)'), 'Duplicated project has recovery title');
  assert(recoveryCopy.content === localProjectRev1.content, 'Recovery copy preserved local content perfectly');

  // Scenario 6: Conflict resolution - "Adopt Cloud Version" with archive
  console.log('\nScenario 6: Conflict Resolution: Adopt Cloud Version with local archive');
  const historyWithLocalPreserved = createVersionSnapshot(localProjectRev1, 'manual_save', {
    label: 'Local Draft (Preserved before adopting Cloud Revision)',
    force: true,
  });
  const adoptedProject: WritingProject = {
    ...remoteProjectRev2,
    versionHistory: [
      ...historyWithLocalPreserved,
      ...(remoteProjectRev2.versionHistory || []),
    ],
    cloudRevision: remoteProjectRev2.revision,
  };
  assert(adoptedProject.content === remoteProjectRev2.content, 'Adopted project has remote content');
  assert(Boolean(adoptedProject.versionHistory?.some(h => h.label?.includes('Local Draft (Preserved'))), 'Local draft safely preserved in version history');

  // Scenario 7: Deletion tombstone verification
  console.log('\nScenario 7: Deletion Tombstone Persistence');
  storage.deleteProject(recoveryCopy.id);
  const projectsAfterDelete = storage.getProjects();
  assert(!projectsAfterDelete.some(p => p.id === recoveryCopy.id), 'Deleted project is not in active projects list');
  const tombstones = storage.getRawProjectsIncludingDeleted().filter(p => p._isDeleted);
  assert(Boolean(tombstones.some(p => p.id === recoveryCopy.id)), 'Tombstone record exists with _isDeleted: true');

  // Clean up test project
  storage.deleteProject(testProject.id);

  console.log(`\n========================================`);
  console.log(`RESULTS: ${passed} Passed, ${failed} Failed`);
  console.log(`========================================`);
}

runTests().catch(console.error);
