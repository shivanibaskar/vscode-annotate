import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { AnnotationSnapshotProvider, SNAPSHOT_SCHEME } from '../../annotationSnapshotProvider';

function makeUri(side: 'original' | 'current', id: string): vscode.Uri {
  return vscode.Uri.from({ scheme: SNAPSHOT_SCHEME, authority: side, path: `/${id}` });
}

suite('AnnotationSnapshotProvider', () => {
  let store: AnnotationStore;
  let provider: AnnotationSnapshotProvider;
  const now = new Date().toISOString();

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    provider = new AnnotationSnapshotProvider(store);
  });

  teardown(async () => {
    await store.clear();
  });

  test('returns placeholder when annotation id is not found', async () => {
    const content = await provider.provideTextDocumentContent(makeUri('original', 'nonexistent'));
    assert.ok(content.includes('not found'), `Expected not-found message, got: ${content}`);
  });

  test('returns contentSnapshot for original side', async () => {
    await store.add({
      id: 'snap-1',
      fileUri: 'src/foo.ts',
      range: { start: 0, end: 1 },
      comment: 'test',
      contentSnapshot: 'const x = 1;\nconst y = 2;',
      createdAt: now,
      updatedAt: now,
    });

    const content = await provider.provideTextDocumentContent(makeUri('original', 'snap-1'));
    assert.strictEqual(content, 'const x = 1;\nconst y = 2;');
  });

  test('returns no-snapshot message for original side when snapshot is absent', async () => {
    await store.add({
      id: 'snap-2',
      fileUri: 'src/bar.ts',
      range: { start: 0, end: 0 },
      comment: 'old annotation',
      createdAt: now,
      updatedAt: now,
    });

    const content = await provider.provideTextDocumentContent(makeUri('original', 'snap-2'));
    assert.ok(content.includes('No snapshot'), `Expected no-snapshot message, got: ${content}`);
  });

  test('returns placeholder for current side when no workspace is open', async () => {
    await store.add({
      id: 'snap-3',
      fileUri: 'src/baz.ts',
      range: { start: 0, end: 0 },
      comment: 'test',
      contentSnapshot: 'hello',
      createdAt: now,
      updatedAt: now,
    });

    // In the test environment there may be no workspace folder; simulate by
    // temporarily returning undefined for workspaceFolders.
    const origFolders = Object.getOwnPropertyDescriptor(vscode.workspace, 'workspaceFolders');
    Object.defineProperty(vscode.workspace, 'workspaceFolders', { get: () => undefined, configurable: true });
    try {
      const content = await provider.provideTextDocumentContent(makeUri('current', 'snap-3'));
      assert.ok(content.includes('No workspace'), `Expected no-workspace message, got: ${content}`);
    } finally {
      if (origFolders) {
        Object.defineProperty(vscode.workspace, 'workspaceFolders', origFolders);
      }
    }
  });
});
