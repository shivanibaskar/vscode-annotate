import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { copyToClipboard } from '../../commands/copyToClipboard';

suite('copyToClipboard command', () => {
  let store: AnnotationStore;
  const warnings: string[] = [];
  const infos: string[] = [];
  let clipboardText: string | undefined;

  let origWarn: typeof vscode.window.showWarningMessage;
  let origInfo: typeof vscode.window.showInformationMessage;
  let origClipboard: typeof vscode.env.clipboard;

  const now = new Date().toISOString();

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    warnings.length = 0;
    infos.length = 0;
    clipboardText = undefined;

    origWarn = vscode.window.showWarningMessage;
    origInfo = vscode.window.showInformationMessage;
    origClipboard = vscode.env.clipboard;

    (vscode.window as any).showWarningMessage     = (msg: string) => { warnings.push(msg); return Promise.resolve(undefined); };
    (vscode.window as any).showInformationMessage = (msg: string) => { infos.push(msg);    return Promise.resolve(undefined); };
    Object.defineProperty(vscode.env, 'clipboard', {
      value: { writeText: async (t: string) => { clipboardText = t; } },
      configurable: true,
    });
  });

  teardown(async () => {
    (vscode.window as any).showWarningMessage     = origWarn;
    (vscode.window as any).showInformationMessage = origInfo;
    Object.defineProperty(vscode.env, 'clipboard', { value: origClipboard, configurable: true });
    await store.clear();
  });

  test('shows warning and does not write clipboard when store is empty', async () => {
    await copyToClipboard(store);
    assert.ok(warnings.some(w => w.includes('No annotations')), 'Expected warning about no annotations');
    assert.strictEqual(clipboardText, undefined, 'Clipboard must not be written when there are no annotations');
  });

  test('writes export text to clipboard when annotations exist', async () => {
    await store.add({ id: '1', fileUri: 'src/a.ts', range: { start: 4, end: 4 }, comment: 'check this', createdAt: now, updatedAt: now });
    await store.add({ id: '2', fileUri: 'src/b.ts', range: { start: 9, end: 9 }, comment: 'another note', createdAt: now, updatedAt: now });

    await copyToClipboard(store);

    assert.ok(warnings.length === 0, 'Expected no warnings');
    assert.ok(clipboardText !== undefined, 'Expected clipboard to be written');
    assert.ok(clipboardText!.includes('check this'), 'Expected annotation comment in clipboard text');
    assert.ok(clipboardText!.includes('another note'), 'Expected second annotation comment in clipboard text');
  });

  test('shows plural confirmation message for multiple annotations', async () => {
    await store.add({ id: '1', fileUri: 'src/a.ts', range: { start: 0, end: 0 }, comment: 'note one', createdAt: now, updatedAt: now });
    await store.add({ id: '2', fileUri: 'src/a.ts', range: { start: 1, end: 1 }, comment: 'note two', createdAt: now, updatedAt: now });

    await copyToClipboard(store);

    assert.ok(infos.some(m => m.includes('2 annotations')), `Expected "2 annotations" in info, got: ${JSON.stringify(infos)}`);
  });

  test('shows singular confirmation message for exactly one annotation', async () => {
    await store.add({ id: '1', fileUri: 'src/a.ts', range: { start: 0, end: 0 }, comment: 'solo note', createdAt: now, updatedAt: now });

    await copyToClipboard(store);

    assert.ok(infos.some(m => m.includes('1 annotation') && !m.includes('1 annotations')),
      `Expected "1 annotation" (singular) in info, got: ${JSON.stringify(infos)}`);
  });
});
