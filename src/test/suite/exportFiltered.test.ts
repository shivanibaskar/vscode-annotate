import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { exportFiltered } from '../../commands/exportFiltered';
import * as exportForLLMModule from '../../commands/exportForLLM';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function withQuickPickMock(
  result: vscode.QuickPickItem[] | undefined,
  fn: () => Promise<void>
): Promise<void> {
  const original = vscode.window.showQuickPick;
  (vscode.window as any).showQuickPick = () => Promise.resolve(result);
  try {
    await fn();
  } finally {
    (vscode.window as any).showQuickPick = original;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('exportFiltered command', () => {
  let store: AnnotationStore;
  let exportCallCount = 0;
  let originalExport: typeof exportForLLMModule.exportForLLM;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    exportCallCount = 0;
    originalExport = exportForLLMModule.exportForLLM;
    (exportForLLMModule as any).exportForLLM = async () => { exportCallCount++; };
  });

  teardown(async () => {
    (exportForLLMModule as any).exportForLLM = originalExport;
    await store.clear();
  });

  const now = () => new Date().toISOString();

  test('shows warning when there are no annotations', async () => {
    const warnings: string[] = [];
    const origWarn = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = (msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined);
    };
    try {
      await exportFiltered(store);
      assert.ok(warnings.some(w => w.includes('No annotations')));
    } finally {
      (vscode.window as any).showWarningMessage = origWarn;
    }
  });

  test('falls back to full export when no annotations contain @mentions', async () => {
    await store.add({ id: '1', fileUri: 'src/a.ts', range: { start: 0, end: 0 }, comment: 'plain comment', createdAt: now(), updatedAt: now() });

    const infos: string[] = [];
    const origInfo = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = (msg: string) => {
      infos.push(msg);
      return Promise.resolve(undefined);
    };
    try {
      await exportFiltered(store);
      assert.ok(infos.some(m => m.includes('No @mentions found')));
      assert.strictEqual(exportCallCount, 1, 'Should fall back to full export');
    } finally {
      (vscode.window as any).showInformationMessage = origInfo;
    }
  });

  test('does nothing when user cancels the QuickPick', async () => {
    await store.add({ id: '2', fileUri: 'src/a.ts', range: { start: 0, end: 0 }, comment: '@todo fix this', createdAt: now(), updatedAt: now() });

    await withQuickPickMock(undefined, async () => {
      await exportFiltered(store);
    });

    assert.strictEqual(exportCallCount, 0, 'Should not export when picker is cancelled');
  });

  test('shows warning when user accepts QuickPick with nothing selected', async () => {
    await store.add({ id: '3', fileUri: 'src/a.ts', range: { start: 0, end: 0 }, comment: '@question why?', createdAt: now(), updatedAt: now() });

    const warnings: string[] = [];
    const origWarn = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = (msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined);
    };
    try {
      await withQuickPickMock([], async () => {
        await exportFiltered(store);
      });
      assert.ok(warnings.some(w => w.includes('No tags selected')));
      assert.strictEqual(exportCallCount, 0);
    } finally {
      (vscode.window as any).showWarningMessage = origWarn;
    }
  });

  test('exports only annotations matching selected @mentions', async () => {
    await store.add({ id: '4', fileUri: 'src/a.ts', range: { start: 0, end: 0 }, comment: '@todo fix auth', createdAt: now(), updatedAt: now() });
    await store.add({ id: '5', fileUri: 'src/b.ts', range: { start: 0, end: 0 }, comment: '@question unclear', createdAt: now(), updatedAt: now() });
    await store.add({ id: '6', fileUri: 'src/c.ts', range: { start: 0, end: 0 }, comment: 'no mention here', createdAt: now(), updatedAt: now() });

    let capturedAnnotationCount = 0;
    (exportForLLMModule as any).exportForLLM = async (s: AnnotationStore) => {
      const d = await s.load();
      capturedAnnotationCount = d.annotations.length;
    };

    await withQuickPickMock([{ label: '@todo' }], async () => {
      await exportFiltered(store);
    });

    assert.strictEqual(capturedAnnotationCount, 1, 'Only the @todo annotation should be exported');
  });

  test('shows warning when selected @mention matches no annotations', async () => {
    await store.add({ id: '7', fileUri: 'src/a.ts', range: { start: 0, end: 0 }, comment: '@todo fix this', createdAt: now(), updatedAt: now() });

    const warnings: string[] = [];
    const origWarn = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = (msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined);
    };
    try {
      await withQuickPickMock([{ label: '@critical' }], async () => {
        await exportFiltered(store);
      });
      assert.ok(warnings.some(w => w.includes('No annotations match')));
      assert.strictEqual(exportCallCount, 0);
    } finally {
      (vscode.window as any).showWarningMessage = origWarn;
    }
  });
});
