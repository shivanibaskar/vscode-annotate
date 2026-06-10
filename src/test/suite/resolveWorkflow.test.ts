import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { Annotation } from '../../types';
import { buildExportText } from '../../commands/buildExportText';
import { exportableAnnotations, noExportMessage } from '../../commands/exportFilter';
import { toggleResolved } from '../../commands/toggleResolved';
import { DecorationsManager } from '../../decorations';
import { AnnotationsTreeProvider, FileNode, AnnotationNode } from '../../annotationsTreeProvider';

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  const now = new Date().toISOString();
  return {
    id: 'resolve-test-id',
    fileUri: 'src/foo.ts',
    range: { start: 0, end: 2 },
    comment: 'resolve workflow test',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

suite('Resolve workflow — store round-trip', () => {
  let store: AnnotationStore;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
  });

  teardown(async () => {
    await store.clear();
    store.dispose();
  });

  test('resolved flag persists through save and reload', async () => {
    await store.add(makeAnnotation({ id: 'r1', resolved: true }));
    await store.flush();

    const fresh = new AnnotationStore();
    const data = await fresh.load();
    assert.strictEqual(data.annotations.length, 1);
    assert.strictEqual(data.annotations[0].resolved, true);
    fresh.dispose();
  });

  test('annotations without the flag load as open', async () => {
    await store.add(makeAnnotation({ id: 'r2' }));
    const data = await store.load();
    assert.strictEqual(data.annotations[0].resolved, undefined);
  });

  test('edit-style update preserves the resolved flag', async () => {
    await store.add(makeAnnotation({ id: 'r3', resolved: true }));
    const data = await store.load();
    // Mirrors editAnnotation's rebuild: rest-spread keeps unknown fields.
    const { tag: _tag, ...base } = data.annotations[0];
    await store.update({ ...base, comment: 'edited' });

    const after = await store.load();
    assert.strictEqual(after.annotations[0].comment, 'edited');
    assert.strictEqual(after.annotations[0].resolved, true);
  });
});

suite('Resolve workflow — toggleResolved command', () => {
  let store: AnnotationStore;
  let decorations: DecorationsManager;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    decorations = new DecorationsManager(store);
  });

  teardown(async () => {
    await store.clear();
    decorations.dispose();
    store.dispose();
  });

  test('toggles an open annotation to resolved', async () => {
    await store.add(makeAnnotation({ id: 't1' }));
    await toggleResolved(store, decorations, { id: 't1' });

    const data = await store.load();
    assert.strictEqual(data.annotations[0].resolved, true);
  });

  test('toggles a resolved annotation back to open, removing the key', async () => {
    await store.add(makeAnnotation({ id: 't2', resolved: true }));
    await toggleResolved(store, decorations, { id: 't2' });

    const data = await store.load();
    assert.strictEqual(data.annotations[0].resolved, undefined);
    assert.ok(!('resolved' in data.annotations[0]), 'Key should be removed entirely');
  });

  test('re-fetches by id so stale argument fields are not written back', async () => {
    await store.add(makeAnnotation({ id: 't3', comment: 'fresh comment' }));
    // Simulate a stale CodeLens argument with an outdated comment.
    const stale = makeAnnotation({ id: 't3', comment: 'STALE comment' });
    await toggleResolved(store, decorations, stale);

    const data = await store.load();
    assert.strictEqual(data.annotations[0].comment, 'fresh comment');
    assert.strictEqual(data.annotations[0].resolved, true);
  });

  test('warns and does nothing for an unknown id', async () => {
    await store.add(makeAnnotation({ id: 't4' }));
    await toggleResolved(store, decorations, { id: 'no-such-id' });

    const data = await store.load();
    assert.strictEqual(data.annotations[0].resolved, undefined);
  });
});

suite('Resolve workflow — export filtering', () => {
  let store: AnnotationStore;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
  });

  teardown(async () => {
    await store.clear();
    store.dispose();
    const config = vscode.workspace.getConfiguration('annotate');
    await config.update('exportIncludeResolved', undefined, vscode.ConfigurationTarget.Workspace);
  });

  test('exportableAnnotations excludes resolved by default', () => {
    const anns = [makeAnnotation({ id: 'a' }), makeAnnotation({ id: 'b', resolved: true })];
    const result = exportableAnnotations(anns);
    assert.deepStrictEqual(result.map(a => a.id), ['a']);
  });

  test('buildExportText omits resolved annotations', async () => {
    await store.add(makeAnnotation({ id: 'e1', comment: 'open note' }));
    await store.add(makeAnnotation({ id: 'e2', comment: 'done note', resolved: true }));

    const text = await buildExportText(store);
    assert.ok(text!.includes('open note'));
    assert.ok(!text!.includes('done note'), 'Resolved annotation must be excluded');
  });

  test('buildExportText returns null when everything is resolved', async () => {
    await store.add(makeAnnotation({ id: 'e3', resolved: true }));
    assert.strictEqual(await buildExportText(store), null);
  });

  test('exportIncludeResolved setting restores resolved annotations', async () => {
    await vscode.workspace.getConfiguration('annotate')
      .update('exportIncludeResolved', true, vscode.ConfigurationTarget.Workspace);

    await store.add(makeAnnotation({ id: 'e4', comment: 'done note', resolved: true }));
    const text = await buildExportText(store);
    assert.ok(text !== null && text.includes('done note'));
  });

  test('noExportMessage distinguishes all-resolved from empty', () => {
    assert.ok(noExportMessage(0).includes('No annotations'));
    assert.ok(noExportMessage(3).includes('resolved'));
    assert.ok(noExportMessage(3).includes('exportIncludeResolved'));
  });
});

suite('Resolve workflow — sidebar', () => {
  let store: AnnotationStore;
  let provider: AnnotationsTreeProvider;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    provider = new AnnotationsTreeProvider(store);
  });

  teardown(async () => {
    await store.clear();
    provider.dispose();
    store.dispose();
    const config = vscode.workspace.getConfiguration('annotate');
    await config.update('sidebarShowResolved', undefined, vscode.ConfigurationTarget.Workspace);
  });

  test('resolved annotations are visible by default with check icon and label', async () => {
    await store.add(makeAnnotation({ id: 's1', resolved: true }));

    const roots = await provider.getChildren();
    assert.strictEqual(roots.length, 1);
    const children = await provider.getChildren(roots[0] as FileNode);
    assert.strictEqual(children.length, 1);
    const node = children[0] as AnnotationNode;
    assert.ok(String(node.description).includes('resolved'));
    assert.strictEqual((node.iconPath as vscode.ThemeIcon).id, 'pass-filled');
  });

  test('file node shows resolved count', async () => {
    await store.add(makeAnnotation({ id: 's2', fileUri: 'src/bar.ts' }));
    await store.add(makeAnnotation({ id: 's3', fileUri: 'src/bar.ts', resolved: true }));

    const roots = await provider.getChildren();
    const fileNode = roots[0] as FileNode;
    assert.strictEqual(fileNode.description, '2 annotations (1 resolved)');
  });

  test('file node keeps legacy label when nothing is resolved', async () => {
    await store.add(makeAnnotation({ id: 's4', fileUri: 'src/baz.ts' }));

    const roots = await provider.getChildren();
    assert.strictEqual((roots[0] as FileNode).description, '1 annotation');
  });

  test('setShowResolved(false) hides resolved annotations', async () => {
    await store.add(makeAnnotation({ id: 's5', fileUri: 'src/qux.ts' }));
    await store.add(makeAnnotation({ id: 's6', fileUri: 'src/qux.ts', resolved: true }));

    provider.setShowResolved(false, false);
    const roots = await provider.getChildren();
    assert.strictEqual((roots[0] as FileNode).description, '1 annotation');
    const children = await provider.getChildren(roots[0] as FileNode);
    assert.strictEqual(children.length, 1);
    assert.strictEqual((children[0] as AnnotationNode).annotation.id, 's5');
  });

  test('a file with only resolved annotations disappears when hiding', async () => {
    await store.add(makeAnnotation({ id: 's7', fileUri: 'src/only-resolved.ts', resolved: true }));

    provider.setShowResolved(false, false);
    const roots = await provider.getChildren();
    assert.strictEqual(roots.length, 0);
  });
});

suite('Resolve workflow — validation', () => {
  test('non-boolean resolved values are rejected on load', async () => {
    const store = new AnnotationStore();
    await store.clear();

    const folders = vscode.workspace.workspaceFolders!;
    const uri = vscode.Uri.joinPath(folders[0].uri, '.vscode/annotations.json');
    const bad = {
      version: 1,
      annotations: [
        { ...makeAnnotation({ id: 'v1' }), resolved: 'yes' },
        makeAnnotation({ id: 'v2', resolved: true }),
      ],
    };
    await vscode.workspace.fs.writeFile(uri, Buffer.from(JSON.stringify(bad), 'utf8'));

    const fresh = new AnnotationStore();
    const data = await fresh.load();
    assert.deepStrictEqual(data.annotations.map(a => a.id), ['v2']);
    fresh.dispose();

    await store.clear();
    store.dispose();
  });
});
