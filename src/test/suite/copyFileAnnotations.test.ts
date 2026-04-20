import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { copyFileAnnotations } from '../../commands/copyFileAnnotations';

suite('copyFileAnnotations command', () => {
  let store: AnnotationStore;
  const warnings: string[] = [];
  const errors: string[] = [];
  const infos: string[] = [];
  let clipboardText: string | undefined;

  let origWarn: typeof vscode.window.showWarningMessage;
  let origError: typeof vscode.window.showErrorMessage;
  let origInfo: typeof vscode.window.showInformationMessage;
  let origClipboard: typeof vscode.env.clipboard;
  let origEditorDesc: PropertyDescriptor | undefined;
  let origAsRelative: typeof vscode.workspace.asRelativePath;

  const now = new Date().toISOString();

  /** Build a minimal fake TextEditor pointing at the given relative path. */
  function fakeEditor(relPath: string, content = ''): Partial<vscode.TextEditor> {
    return {
      document: {
        uri: vscode.Uri.file(`/fake/workspace/${relPath}`),
        getText: () => content,
      } as any,
    };
  }

  /** Set the active editor via Object.defineProperty (activeTextEditor is getter-only). */
  function setActiveEditor(editor: Partial<vscode.TextEditor> | undefined): void {
    Object.defineProperty(vscode.window, 'activeTextEditor', { value: editor, configurable: true });
  }

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    warnings.length = 0;
    errors.length = 0;
    infos.length = 0;
    clipboardText = undefined;

    origWarn  = vscode.window.showWarningMessage;
    origError = vscode.window.showErrorMessage;
    origInfo  = vscode.window.showInformationMessage;
    origClipboard = vscode.env.clipboard;
    origEditorDesc = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor');
    origAsRelative = vscode.workspace.asRelativePath;

    (vscode.window as any).showWarningMessage     = (msg: string) => { warnings.push(msg); return Promise.resolve(undefined); };
    (vscode.window as any).showErrorMessage       = (msg: string) => { errors.push(msg);   return Promise.resolve(undefined); };
    (vscode.window as any).showInformationMessage = (msg: string) => { infos.push(msg);    return Promise.resolve(undefined); };
    Object.defineProperty(vscode.env, 'clipboard', {
      value: { writeText: async (t: string) => { clipboardText = t; } },
      configurable: true,
    });

    // Stub asRelativePath to return the path segment after /fake/workspace/.
    (vscode.workspace as any).asRelativePath = (uri: vscode.Uri) => {
      const p = uri.fsPath;
      const idx = p.indexOf('/fake/workspace/');
      return idx >= 0 ? p.slice(idx + '/fake/workspace/'.length) : p;
    };
  });

  teardown(async () => {
    (vscode.window as any).showWarningMessage     = origWarn;
    (vscode.window as any).showErrorMessage       = origError;
    (vscode.window as any).showInformationMessage = origInfo;
    Object.defineProperty(vscode.env, 'clipboard', { value: origClipboard, configurable: true });
    if (origEditorDesc) {
      Object.defineProperty(vscode.window, 'activeTextEditor', origEditorDesc);
    }
    (vscode.workspace as any).asRelativePath = origAsRelative;
    await store.clear();
  });

  test('shows error and does not write clipboard when there is no active editor', async () => {
    setActiveEditor(undefined);

    await copyFileAnnotations(store);

    assert.ok(errors.some(e => e.includes('No active editor')), `Expected "No active editor" error, got: ${JSON.stringify(errors)}`);
    assert.strictEqual(clipboardText, undefined, 'Clipboard must not be written without an active editor');
  });

  test('shows warning when the active file has no annotations', async () => {
    setActiveEditor(fakeEditor('src/empty.ts', 'const x = 1;\n'));

    await copyFileAnnotations(store);

    assert.ok(warnings.some(w => w.includes('No annotations')), `Expected "No annotations" warning, got: ${JSON.stringify(warnings)}`);
    assert.strictEqual(clipboardText, undefined, 'Clipboard must not be written when there are no annotations for the file');
  });

  test('copies annotations for the active file only', async () => {
    const relPath = 'src/target.ts';
    setActiveEditor(fakeEditor(relPath, 'line0\nline1\nline2\n'));

    await store.add({ id: '1', fileUri: relPath,        range: { start: 0, end: 0 }, comment: 'note in target', createdAt: now, updatedAt: now });
    await store.add({ id: '2', fileUri: 'src/other.ts', range: { start: 0, end: 0 }, comment: 'note in other',  createdAt: now, updatedAt: now });

    await copyFileAnnotations(store);

    assert.ok(clipboardText !== undefined, 'Expected clipboard to be written');
    assert.ok(clipboardText!.includes('note in target'), 'Expected the target file annotation in clipboard');
    assert.ok(!clipboardText!.includes('note in other'), 'Expected other-file annotation to be excluded');
    assert.ok(clipboardText!.includes(relPath), 'Expected the file path in the clipboard header');
  });

  test('shows plural confirmation message for multiple annotations', async () => {
    const relPath = 'src/multi.ts';
    setActiveEditor(fakeEditor(relPath, 'a\nb\nc\n'));

    await store.add({ id: '1', fileUri: relPath, range: { start: 0, end: 0 }, comment: 'alpha', createdAt: now, updatedAt: now });
    await store.add({ id: '2', fileUri: relPath, range: { start: 1, end: 1 }, comment: 'beta',  createdAt: now, updatedAt: now });

    await copyFileAnnotations(store);

    assert.ok(infos.some(m => m.includes('2 annotation')), `Expected "2 annotation" in info, got: ${JSON.stringify(infos)}`);
  });

  test('shows singular confirmation message for exactly one annotation', async () => {
    const relPath = 'src/single.ts';
    setActiveEditor(fakeEditor(relPath, 'only line\n'));

    await store.add({ id: '1', fileUri: relPath, range: { start: 0, end: 0 }, comment: 'solo', createdAt: now, updatedAt: now });

    await copyFileAnnotations(store);

    assert.ok(
      infos.some(m => m.includes('1 annotation') && !m.includes('1 annotations')),
      `Expected "1 annotation" (singular) in info, got: ${JSON.stringify(infos)}`
    );
  });

  test('clipboard output includes a FILE header block', async () => {
    const relPath = 'src/header.ts';
    setActiveEditor(fakeEditor(relPath, 'x\n'));

    await store.add({ id: '1', fileUri: relPath, range: { start: 0, end: 0 }, comment: 'header check', createdAt: now, updatedAt: now });

    await copyFileAnnotations(store);

    assert.ok(clipboardText!.startsWith('FILE:'), `Expected output to start with "FILE:", got: ${clipboardText!.slice(0, 40)}`);
    assert.ok(clipboardText!.includes('Annotations:'), 'Expected "Annotations:" count line in header');
    assert.ok(clipboardText!.includes('Generated:'), 'Expected "Generated:" timestamp in header');
  });
});
