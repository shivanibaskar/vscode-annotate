import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { AnnotationCodeLensProvider } from '../../annotationCodeLensProvider';
import { Annotation } from '../../types';

async function openDocument(content: string): Promise<vscode.TextDocument> {
  return vscode.workspace.openTextDocument({ content, language: 'typescript' });
}

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  const now = new Date().toISOString();
  return {
    id: 'test-id',
    fileUri: 'src/foo.ts',
    range: { start: 0, end: 0 },
    comment: 'test comment',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

suite('AnnotationCodeLensProvider', () => {
  let store: AnnotationStore;
  let provider: AnnotationCodeLensProvider;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    provider = new AnnotationCodeLensProvider(store);
  });

  teardown(async () => {
    await store.clear();
  });

  test('single annotation produces three lenses (preview, pencil, trash)', async () => {
    const doc = await openDocument('line 0\nline 1\nline 2\nline 3\nline 4\n');
    await store.add(makeAnnotation({
      id: 'a',
      fileUri: vscode.workspace.asRelativePath(doc.uri, false),
      range: { start: 2, end: 2 },
      comment: 'my note',
    }));

    const lenses = await provider.provideCodeLenses(doc);

    assert.strictEqual(lenses.length, 3);
    assert.ok(lenses[0].command!.title.includes('my note'), 'preview should contain comment');
    assert.strictEqual(lenses[1].command!.title, '$(pencil)');
    assert.strictEqual(lenses[2].command!.title, '$(trash)');
    for (const lens of lenses) {
      assert.strictEqual(lens.range.start.line, 2);
    }
  });

  test('two annotations on the same start line produce a single summary lens', async () => {
    const doc = await openDocument('line 0\nline 1\nline 2\nline 3\nline 4\n');
    const relPath = vscode.workspace.asRelativePath(doc.uri, false);
    await store.add(makeAnnotation({ id: 'a', fileUri: relPath, range: { start: 2, end: 2 }, comment: 'alpha' }));
    await store.add(makeAnnotation({ id: 'b', fileUri: relPath, range: { start: 2, end: 3 }, comment: 'beta' }));

    const lenses = await provider.provideCodeLenses(doc);

    assert.strictEqual(lenses.length, 1);
    assert.ok(lenses[0].command!.title.includes('2 annotations on this line'));
    assert.strictEqual(lenses[0].range.start.line, 2);
  });

  test('three annotations on the same start line show correct count', async () => {
    const doc = await openDocument('line 0\nline 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\n');
    const relPath = vscode.workspace.asRelativePath(doc.uri, false);
    for (const id of ['x', 'y', 'z']) {
      await store.add(makeAnnotation({ id, fileUri: relPath, range: { start: 4, end: 4 } }));
    }

    const lenses = await provider.provideCodeLenses(doc);

    assert.strictEqual(lenses.length, 1);
    assert.ok(lenses[0].command!.title.includes('3 annotations on this line'));
  });

  test('annotations on different lines produce independent lens groups', async () => {
    const doc = await openDocument('line 0\nline 1\nline 2\nline 3\nline 4\n');
    const relPath = vscode.workspace.asRelativePath(doc.uri, false);
    await store.add(makeAnnotation({ id: 'a', fileUri: relPath, range: { start: 1, end: 1 } }));
    await store.add(makeAnnotation({ id: 'b', fileUri: relPath, range: { start: 3, end: 3 } }));

    const lenses = await provider.provideCodeLenses(doc);

    assert.strictEqual(lenses.length, 6);
    assert.ok(lenses.slice(0, 3).every(l => l.range.start.line === 1));
    assert.ok(lenses.slice(3, 6).every(l => l.range.start.line === 3));
  });

  test('annotation range beyond document end clamps to last line', async () => {
    const doc = await openDocument('line 0\nline 1\nline 2\n');
    const relPath = vscode.workspace.asRelativePath(doc.uri, false);
    await store.add(makeAnnotation({ id: 'a', fileUri: relPath, range: { start: 99, end: 99 } }));

    const lenses = await provider.provideCodeLenses(doc);

    assert.ok(lenses.length > 0);
    assert.strictEqual(lenses[0].range.start.line, doc.lineCount - 1);
  });

  test('annotation at line 0 does not produce negative range', async () => {
    const doc = await openDocument('line 0\nline 1\n');
    const relPath = vscode.workspace.asRelativePath(doc.uri, false);
    await store.add(makeAnnotation({ id: 'a', fileUri: relPath, range: { start: 0, end: 0 } }));

    const lenses = await provider.provideCodeLenses(doc);

    assert.ok(lenses.length > 0);
    assert.strictEqual(lenses[0].range.start.line, 0);
  });

  test('summary lens tooltip contains all annotation comments', async () => {
    const doc = await openDocument('line 0\nline 1\nline 2\n');
    const relPath = vscode.workspace.asRelativePath(doc.uri, false);
    await store.add(makeAnnotation({ id: 'a', fileUri: relPath, range: { start: 1, end: 1 }, comment: 'alpha' }));
    await store.add(makeAnnotation({ id: 'b', fileUri: relPath, range: { start: 1, end: 1 }, comment: 'beta' }));

    const lenses = await provider.provideCodeLenses(doc);

    assert.strictEqual(lenses.length, 1);
    const tooltip = lenses[0].command!.tooltip as string;
    assert.ok(tooltip.includes('alpha'));
    assert.ok(tooltip.includes('beta'));
  });

  test('two annotations with different end lines but same start line collapse to one summary', async () => {
    const doc = await openDocument('line 0\nline 1\nline 2\nline 3\nline 4\nline 5\n');
    const relPath = vscode.workspace.asRelativePath(doc.uri, false);
    await store.add(makeAnnotation({ id: 'a', fileUri: relPath, range: { start: 2, end: 2 } }));
    await store.add(makeAnnotation({ id: 'b', fileUri: relPath, range: { start: 2, end: 5 } }));

    const lenses = await provider.provideCodeLenses(doc);

    assert.strictEqual(lenses.length, 1);
    assert.ok(lenses[0].command!.title.includes('2 annotations on this line'));
  });

  test('no annotations produces empty lens array', async () => {
    const doc = await openDocument('line 0\nline 1\n');
    const lenses = await provider.provideCodeLenses(doc);
    assert.strictEqual(lenses.length, 0);
  });

  test('onDidChangeCodeLenses fires when store changes', async () => {
    let fired = 0;
    provider.onDidChangeCodeLenses(() => { fired++; });

    const relPath = 'src/fire-test.ts';
    await store.add(makeAnnotation({ id: 'fire1', fileUri: relPath }));

    assert.ok(fired >= 1, `Expected onDidChangeCodeLenses to fire, got ${fired}`);
  });
});
