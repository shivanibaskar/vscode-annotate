import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { AnnotationHoverProvider } from '../../hoverProvider';

async function openDocument(content: string): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ content, language: 'typescript' });
  return vscode.window.showTextDocument(doc);
}

suite('AnnotationHoverProvider', () => {
  let store: AnnotationStore;
  let provider: AnnotationHoverProvider;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    provider = new AnnotationHoverProvider(store);
  });

  teardown(async () => {
    await store.clear();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('returns undefined when hovered line has no annotation', async () => {
    const editor = await openDocument('line 0\nline 1\nline 2\n');
    await store.add({
      id: 'h1',
      fileUri: vscode.workspace.asRelativePath(editor.document.uri, false),
      range: { start: 5, end: 7 },
      comment: 'not on line 1',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const hover = await provider.provideHover(editor.document, new vscode.Position(1, 0));
    assert.strictEqual(hover, undefined);
  });

  test('returns a Hover when position falls within annotation range', async () => {
    const editor = await openDocument('line 0\nline 1\nline 2\n');
    await store.add({
      id: 'h2',
      fileUri: vscode.workspace.asRelativePath(editor.document.uri, false),
      range: { start: 0, end: 2 },
      comment: 'covers lines 0-2',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const hover = await provider.provideHover(editor.document, new vscode.Position(1, 0));
    assert.ok(hover, 'Expected a hover to be returned');
  });

  test('hover content includes the annotation comment', async () => {
    const editor = await openDocument('hello\n');
    await store.add({
      id: 'h3',
      fileUri: vscode.workspace.asRelativePath(editor.document.uri, false),
      range: { start: 0, end: 0 },
      comment: 'unique comment text 12345',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const hover = await provider.provideHover(editor.document, new vscode.Position(0, 0));
    assert.ok(hover, 'Expected hover');
    const combined = (hover.contents as vscode.MarkdownString[])
      .map(c => c.value)
      .join('');
    assert.ok(combined.includes('unique comment text 12345'), 'Comment should appear in hover content');
  });

  test('hover range covers the full annotated line span', async () => {
    const editor = await openDocument('a\nb\nc\nd\n');
    await store.add({
      id: 'h4',
      fileUri: vscode.workspace.asRelativePath(editor.document.uri, false),
      range: { start: 1, end: 3 },
      comment: 'multi-line annotation',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const hover = await provider.provideHover(editor.document, new vscode.Position(2, 0));
    assert.ok(hover?.range, 'Expected hover range');
    assert.strictEqual(hover!.range!.start.line, 1);
    assert.strictEqual(hover!.range!.end.line, 3);
  });

  test('multiple annotations on same line are merged into one hover', async () => {
    const editor = await openDocument('overlap\n');
    const fileUri = vscode.workspace.asRelativePath(editor.document.uri, false);
    const now = new Date().toISOString();
    await store.add({ id: 'm1', fileUri, range: { start: 0, end: 0 }, comment: 'first note',  createdAt: now, updatedAt: now });
    await store.add({ id: 'm2', fileUri, range: { start: 0, end: 0 }, comment: 'second note', createdAt: now, updatedAt: now });

    const hover = await provider.provideHover(editor.document, new vscode.Position(0, 0));
    assert.ok(hover, 'Expected hover');
    const combined = (hover.contents as vscode.MarkdownString[]).map(c => c.value).join('');
    assert.ok(combined.includes('first note'),  'First comment should appear');
    assert.ok(combined.includes('second note'), 'Second comment should appear');
  });

  test('hover range is the union of all matching annotation ranges', async () => {
    const editor = await openDocument('a\nb\nc\nd\ne\n');
    const fileUri = vscode.workspace.asRelativePath(editor.document.uri, false);
    const now = new Date().toISOString();
    await store.add({ id: 'u1', fileUri, range: { start: 1, end: 2 }, comment: 'first',  createdAt: now, updatedAt: now });
    await store.add({ id: 'u2', fileUri, range: { start: 2, end: 4 }, comment: 'second', createdAt: now, updatedAt: now });

    const hover = await provider.provideHover(editor.document, new vscode.Position(2, 0));
    assert.ok(hover?.range, 'Expected hover range');
    assert.strictEqual(hover!.range!.start.line, 1, 'Start should be min of all matching ranges');
    assert.strictEqual(hover!.range!.end.line,   4, 'End should be max of all matching ranges');
  });
});
