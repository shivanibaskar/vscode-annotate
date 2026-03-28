import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { exportMarkdown } from '../../commands/exportMarkdown';

suite('exportMarkdown', () => {
  let store: AnnotationStore;
  let openedDoc: vscode.TextDocument | undefined;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    openedDoc = undefined;

    // Capture the document opened by exportMarkdown without actually displaying it
    const originalShow = vscode.window.showTextDocument;
    (vscode.window as any).showTextDocument = async (doc: vscode.TextDocument) => {
      openedDoc = doc;
      return {} as vscode.TextEditor;
    };
  });

  teardown(async () => {
    // Restore showTextDocument
    delete (vscode.window as any).showTextDocument;
    await store.clear();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('shows warning when there are no annotations', async () => {
    const warnings: string[] = [];
    const orig = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = (msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined);
    };

    try {
      await exportMarkdown(store);
      assert.ok(warnings.some(m => m.toLowerCase().includes('no annotations')));
    } finally {
      (vscode.window as any).showWarningMessage = orig;
    }
  });

  test('output starts with h1 heading', async () => {
    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri: 'src/foo.ts', range: { start: 0, end: 0 }, comment: 'note', createdAt: now, updatedAt: now });

    await exportMarkdown(store);
    const content = openedDoc!.getText();
    assert.ok(content.startsWith('# Annotated Code Context'), 'Expected h1 heading');
  });

  test('output includes file as h2 heading', async () => {
    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri: 'src/foo.ts', range: { start: 0, end: 0 }, comment: 'note', createdAt: now, updatedAt: now });

    await exportMarkdown(store);
    const content = openedDoc!.getText();
    assert.ok(content.includes('## src/foo.ts'), 'Expected file as h2');
  });

  test('output includes h3 line reference and blockquote comment', async () => {
    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri: 'src/foo.ts', range: { start: 2, end: 4 }, comment: 'explain this', createdAt: now, updatedAt: now });

    await exportMarkdown(store);
    const content = openedDoc!.getText();
    assert.ok(content.includes('### Lines 3–5'), 'Expected h3 line reference');
    assert.ok(content.includes('> explain this'), 'Expected blockquote comment');
  });

  test('output includes tag badge when tag is present', async () => {
    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri: 'src/foo.ts', range: { start: 0, end: 0 }, comment: 'note', tag: 'todo', createdAt: now, updatedAt: now });

    await exportMarkdown(store);
    const content = openedDoc!.getText();
    assert.ok(content.includes('[todo]'), 'Expected tag badge in output');
  });

  test('files are sorted alphabetically', async () => {
    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri: 'src/zebra.ts', range: { start: 0, end: 0 }, comment: 'z', createdAt: now, updatedAt: now });
    await store.add({ id: '2', fileUri: 'src/alpha.ts', range: { start: 0, end: 0 }, comment: 'a', createdAt: now, updatedAt: now });

    await exportMarkdown(store);
    const content = openedDoc!.getText();
    const alphaPos = content.indexOf('src/alpha.ts');
    const zebraPos = content.indexOf('src/zebra.ts');
    assert.ok(alphaPos < zebraPos, 'Files should be sorted alphabetically');
  });

  test('output language is markdown', async () => {
    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri: 'src/foo.ts', range: { start: 0, end: 0 }, comment: 'note', createdAt: now, updatedAt: now });

    await exportMarkdown(store);
    assert.strictEqual(openedDoc!.languageId, 'markdown');
  });
});
