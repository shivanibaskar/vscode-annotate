import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { exportForLLM } from '../../commands/exportForLLM';

suite('exportForLLM', () => {
  let store: AnnotationStore;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
  });

  teardown(async () => {
    await store.clear();
  });

  test('shows a warning and does not write to clipboard when there are no annotations', async () => {
    // Record any messages shown
    const messages: string[] = [];
    const originalShow = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = (...args: any[]) => {
      messages.push(args[0]);
      return Promise.resolve(undefined);
    };

    try {
      await exportForLLM(store);
      assert.ok(
        messages.some(m => m.toLowerCase().includes('no annotations')),
        'Expected a "no annotations" warning'
      );
    } finally {
      (vscode.window as any).showWarningMessage = originalShow;
    }
  });

  test('writes to clipboard when annotations exist', async () => {
    await store.add({
      id: 'export-1',
      fileUri: 'src/foo.ts',
      range: { start: 0, end: 1 },
      comment: 'explains foo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let clipboardContent = '';
    const originalWrite = vscode.env.clipboard.writeText;
    (vscode.env.clipboard as any).writeText = (text: string) => {
      clipboardContent = text;
      return Promise.resolve();
    };

    try {
      await exportForLLM(store);
      assert.ok(clipboardContent.includes('ANNOTATED CODE CONTEXT'), 'Expected header in output');
      assert.ok(clipboardContent.includes('src/foo.ts'), 'Expected file path in output');
      assert.ok(clipboardContent.includes('explains foo'), 'Expected comment in output');
    } finally {
      (vscode.env.clipboard as any).writeText = originalWrite;
    }
  });

  test('output includes 1-based line numbers', async () => {
    await store.add({
      id: 'lines-1',
      fileUri: 'src/bar.ts',
      range: { start: 4, end: 7 }, // 0-based → should render as Lines 5–8
      comment: 'check line numbers',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    let clipboardContent = '';
    const originalWrite = vscode.env.clipboard.writeText;
    (vscode.env.clipboard as any).writeText = (text: string) => {
      clipboardContent = text;
      return Promise.resolve();
    };

    try {
      await exportForLLM(store);
      assert.ok(clipboardContent.includes('Lines 5'), 'Expected 1-based start line');
      assert.ok(clipboardContent.includes('8'), 'Expected 1-based end line');
    } finally {
      (vscode.env.clipboard as any).writeText = originalWrite;
    }
  });

  test('output groups annotations by file', async () => {
    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri: 'src/alpha.ts', range: { start: 0, end: 0 }, comment: 'alpha note', createdAt: now, updatedAt: now });
    await store.add({ id: '2', fileUri: 'src/beta.ts',  range: { start: 0, end: 0 }, comment: 'beta note',  createdAt: now, updatedAt: now });

    let clipboardContent = '';
    const originalWrite = vscode.env.clipboard.writeText;
    (vscode.env.clipboard as any).writeText = (text: string) => {
      clipboardContent = text;
      return Promise.resolve();
    };

    try {
      await exportForLLM(store);
      const alphaPos = clipboardContent.indexOf('src/alpha.ts');
      const betaPos  = clipboardContent.indexOf('src/beta.ts');
      assert.ok(alphaPos !== -1, 'alpha.ts should appear in output');
      assert.ok(betaPos  !== -1, 'beta.ts should appear in output');
      // Files sorted alphabetically — alpha before beta
      assert.ok(alphaPos < betaPos, 'Files should be sorted alphabetically');
    } finally {
      (vscode.env.clipboard as any).writeText = originalWrite;
    }
  });
});
