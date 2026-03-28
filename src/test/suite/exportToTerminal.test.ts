import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { exportToTerminal } from '../../commands/exportToTerminal';

suite('exportToTerminal command', () => {
  let store: AnnotationStore;
  const warnings: string[] = [];
  const infos: string[] = [];
  let origWarn: typeof vscode.window.showWarningMessage;
  let origInfo: typeof vscode.window.showInformationMessage;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    warnings.length = 0;
    infos.length = 0;
    origWarn = vscode.window.showWarningMessage;
    origInfo = vscode.window.showInformationMessage;
    (vscode.window as any).showWarningMessage     = (msg: string) => { warnings.push(msg); return Promise.resolve(undefined); };
    (vscode.window as any).showInformationMessage = (msg: string) => { infos.push(msg);    return Promise.resolve(undefined); };
  });

  teardown(async () => {
    (vscode.window as any).showWarningMessage     = origWarn;
    (vscode.window as any).showInformationMessage = origInfo;
    await store.clear();
  });

  const now = new Date().toISOString();

  test('shows warning when there are no annotations', async () => {
    await exportToTerminal(store);
    assert.ok(warnings.some(w => w.includes('No annotations')));
  });

  test('shows warning when no terminals are open', async () => {
    await store.add({ id: '1', fileUri: 'src/a.ts', range: { start: 0, end: 0 }, comment: 'note', createdAt: now, updatedAt: now });

    const origTerminals = Object.getOwnPropertyDescriptor(vscode.window, 'terminals');
    Object.defineProperty(vscode.window, 'terminals', { get: () => [], configurable: true });
    try {
      await exportToTerminal(store);
      assert.ok(warnings.some(w => w.includes('No open terminals')));
    } finally {
      if (origTerminals) { Object.defineProperty(vscode.window, 'terminals', origTerminals); }
    }
  });

  test('sends text to terminal without newline when one terminal is open', async () => {
    await store.add({ id: '2', fileUri: 'src/b.ts', range: { start: 0, end: 0 }, comment: 'terminal test', createdAt: now, updatedAt: now });

    let sentText: string | undefined;
    let sentNewLine: boolean | undefined;
    const fakeTerminal: Partial<vscode.Terminal> = {
      name: 'bash',
      sendText: (text: string, addNewLine?: boolean) => {
        sentText    = text;
        sentNewLine = addNewLine;
      },
      show: () => {},
      processId: Promise.resolve(1234),
    };

    const origTerminals = Object.getOwnPropertyDescriptor(vscode.window, 'terminals');
    Object.defineProperty(vscode.window, 'terminals', { get: () => [fakeTerminal], configurable: true });
    try {
      await exportToTerminal(store);
      assert.ok(sentText !== undefined,              'Expected sendText to be called');
      assert.ok(sentText!.includes('terminal test'), 'Expected annotation comment in sent text');
      assert.strictEqual(sentNewLine, false,         'Expected no trailing newline so user can add question');
      assert.ok(infos.some(m => m.includes('sent to terminal')), 'Expected confirmation message');
    } finally {
      if (origTerminals) { Object.defineProperty(vscode.window, 'terminals', origTerminals); }
    }
  });
});
