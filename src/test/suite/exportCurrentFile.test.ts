import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { exportCurrentFile } from '../../commands/exportCurrentFile';
import * as exportPreviewPanelModule from '../../panels/exportPreviewPanel';

suite('exportCurrentFile', () => {
  let store: AnnotationStore;
  let lastShownContent = '';
  let originalShow: typeof exportPreviewPanelModule.ExportPreviewPanel.show;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    lastShownContent = '';
    originalShow = exportPreviewPanelModule.ExportPreviewPanel.show;
    exportPreviewPanelModule.ExportPreviewPanel.show = (content: string) => {
      lastShownContent = content;
    };
  });

  teardown(async () => {
    exportPreviewPanelModule.ExportPreviewPanel.show = originalShow;
    await store.clear();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('shows error when no active editor', async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    const errors: string[] = [];
    const orig = vscode.window.showErrorMessage;
    (vscode.window as any).showErrorMessage = (msg: string) => {
      errors.push(msg);
      return Promise.resolve(undefined);
    };

    try {
      await exportCurrentFile(store);
      assert.ok(errors.some(m => m.toLowerCase().includes('no active editor')));
    } finally {
      (vscode.window as any).showErrorMessage = orig;
    }
  });

  test('shows warning when current file has no annotations', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'hello\n', language: 'typescript' });
    await vscode.window.showTextDocument(doc);

    const warnings: string[] = [];
    const orig = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = (msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined);
    };

    try {
      await exportCurrentFile(store);
      assert.ok(warnings.some(m => m.toLowerCase().includes('no annotations')));
    } finally {
      (vscode.window as any).showWarningMessage = orig;
    }
  });

  test('shows preview with only annotations for the active file', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'line 0\nline 1\n', language: 'typescript' });
    const editor = await vscode.window.showTextDocument(doc);
    const fileUri = vscode.workspace.asRelativePath(editor.document.uri, false);

    const now = new Date().toISOString();
    await store.add({ id: 'current', fileUri, range: { start: 0, end: 1 }, comment: 'active file note', createdAt: now, updatedAt: now });
    await store.add({ id: 'other',   fileUri: 'src/other.ts', range: { start: 0, end: 0 }, comment: 'other file', createdAt: now, updatedAt: now });

    await exportCurrentFile(store);

    assert.ok(lastShownContent.includes('active file note'), 'Expected current file annotation');
    assert.ok(!lastShownContent.includes('other file'), 'Should not include other file annotations');
  });

  test('output includes 1-based line numbers', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'a\nb\nc\n', language: 'typescript' });
    const editor = await vscode.window.showTextDocument(doc);
    const fileUri = vscode.workspace.asRelativePath(editor.document.uri, false);

    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri, range: { start: 2, end: 4 }, comment: 'note', createdAt: now, updatedAt: now });

    await exportCurrentFile(store);
    assert.ok(lastShownContent.includes('Lines 3'), 'Expected 1-based start line');
  });

  test('output includes TAG line when annotation has a tag', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'code\n', language: 'typescript' });
    const editor = await vscode.window.showTextDocument(doc);
    const fileUri = vscode.workspace.asRelativePath(editor.document.uri, false);

    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri, range: { start: 0, end: 0 }, comment: 'note', tag: 'important', createdAt: now, updatedAt: now });

    await exportCurrentFile(store);
    assert.ok(lastShownContent.includes('TAG: important'));
  });
});
