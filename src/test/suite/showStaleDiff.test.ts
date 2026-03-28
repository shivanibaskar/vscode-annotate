import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { showStaleDiff } from '../../commands/showStaleDiff';

suite('showStaleDiff command — guard conditions', () => {
  let store: AnnotationStore;
  const infos: string[] = [];
  const warnings: string[] = [];
  let origInfo: typeof vscode.window.showInformationMessage;
  let origWarn: typeof vscode.window.showWarningMessage;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    infos.length = 0;
    warnings.length = 0;
    origInfo = vscode.window.showInformationMessage;
    origWarn = vscode.window.showWarningMessage;
    (vscode.window as any).showInformationMessage = (msg: string) => { infos.push(msg); return Promise.resolve(undefined); };
    (vscode.window as any).showWarningMessage     = (msg: string) => { warnings.push(msg); return Promise.resolve(undefined); };
  });

  teardown(async () => {
    (vscode.window as any).showInformationMessage = origInfo;
    (vscode.window as any).showWarningMessage     = origWarn;
    await store.clear();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('shows info when annotation has no contentSnapshot', async () => {
    const now = new Date().toISOString();
    const ann = { id: 'diff-1', fileUri: 'src/a.ts', range: { start: 0, end: 0 }, comment: 'no snap', createdAt: now, updatedAt: now };
    await showStaleDiff(store, ann);
    assert.ok(infos.some(m => m.includes('no content snapshot')), `Expected no-snapshot info, got: ${JSON.stringify(infos)}`);
  });

  test('shows warning when no active editor and no node provided', async () => {
    // Close all editors so activeTextEditor is undefined.
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await showStaleDiff(store, undefined);
    assert.ok(warnings.some(w => w.includes('No active editor')), `Expected no-editor warning, got: ${JSON.stringify(warnings)}`);
  });

  test('shows warning when no annotation exists at cursor position', async () => {
    // Mock activeTextEditor so the test doesn't need a real VS Code window.
    const fakeEditor = {
      selection: { active: { line: 5 } },
      document: { uri: vscode.Uri.file('/workspace/src/fake.ts') },
    };
    const origDescriptor = Object.getOwnPropertyDescriptor(vscode.window, 'activeTextEditor');
    Object.defineProperty(vscode.window, 'activeTextEditor', { get: () => fakeEditor, configurable: true });
    try {
      await showStaleDiff(store, undefined);
      assert.ok(warnings.some(w => w.includes('No annotation found at cursor')), `Expected cursor warning, got: ${JSON.stringify(warnings)}`);
    } finally {
      if (origDescriptor) {
        Object.defineProperty(vscode.window, 'activeTextEditor', origDescriptor);
      }
    }
  });

  test('shows info when annotation is not actually stale', async () => {
    // Use package.json which is guaranteed to exist in the workspace.
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) { return; } // skip in environments with no workspace

    const now = new Date().toISOString();
    const raw = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folders[0].uri, 'package.json'));
    const firstLine = Buffer.from(raw).toString('utf8').split('\n')[0];

    const ann = {
      id: 'diff-not-stale',
      fileUri: 'package.json',
      range: { start: 0, end: 0 },
      comment: 'fresh annotation',
      contentSnapshot: firstLine, // matches current content exactly → not stale
      createdAt: now,
      updatedAt: now,
    };
    await store.add(ann);

    await showStaleDiff(store, ann);
    assert.ok(infos.some(m => m.includes('not stale')), `Expected not-stale info, got: ${JSON.stringify(infos)}`);
  });
});
