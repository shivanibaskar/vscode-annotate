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

  test('re-uses remembered terminal by name on second call (no picker)', async () => {
    await store.add({ id: '3', fileUri: 'src/c.ts', range: { start: 0, end: 0 }, comment: 'retarget', createdAt: now, updatedAt: now });

    const sentTo: string[] = [];
    const makeTerminal = (name: string): Partial<vscode.Terminal> => ({
      name,
      sendText: () => { sentTo.push(name); },
      show: () => {},
    });

    // Use names that don't collide with earlier tests ('bash' may be remembered).
    const termA = makeTerminal('claude-code');
    const termB = makeTerminal('zsh');

    const origTerminals = Object.getOwnPropertyDescriptor(vscode.window, 'terminals');
    const origQP = vscode.window.showQuickPick;

    // First call with two terminals — mock picker to select termA.
    Object.defineProperty(vscode.window, 'terminals', { get: () => [termA, termB], configurable: true });
    (vscode.window as any).showQuickPick = async (items: any[]) =>
      items.find((i: any) => i.label === 'claude-code');

    try {
      await exportToTerminal(store);
      assert.deepStrictEqual(sentTo, ['claude-code'], 'First call should use picked terminal');

      // Second call — picker must NOT be shown; remembered name should be used.
      (vscode.window as any).showQuickPick = async () => {
        throw new Error('Picker should not open for a remembered terminal');
      };
      await exportToTerminal(store);
      assert.deepStrictEqual(sentTo, ['claude-code', 'claude-code'], 'Second call should re-use remembered terminal by name');
    } finally {
      (vscode.window as any).showQuickPick = origQP;
      if (origTerminals) { Object.defineProperty(vscode.window, 'terminals', origTerminals); }
    }
  });
});
