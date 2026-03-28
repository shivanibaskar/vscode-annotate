import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { searchAnnotations } from '../../commands/searchAnnotations';

suite('searchAnnotations', () => {
  let store: AnnotationStore;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
  });

  teardown(async () => {
    await store.clear();
  });

  test('shows warning when there are no annotations', async () => {
    const warnings: string[] = [];
    const orig = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = (msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined);
    };

    try {
      await searchAnnotations(store);
      assert.ok(warnings.some(m => m.toLowerCase().includes('no annotations')));
    } finally {
      (vscode.window as any).showWarningMessage = orig;
    }
  });

  test('quick-pick items include comment as label', async () => {
    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri: 'src/foo.ts', range: { start: 0, end: 0 }, comment: 'search me', createdAt: now, updatedAt: now });

    let capturedItems: vscode.QuickPickItem[] = [];
    const orig = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = (items: vscode.QuickPickItem[]) => {
      capturedItems = items;
      return Promise.resolve(undefined); // user cancels
    };

    try {
      await searchAnnotations(store);
      assert.ok(capturedItems.some(i => i.label === 'search me'));
    } finally {
      (vscode.window as any).showQuickPick = orig;
    }
  });

  test('quick-pick items include filename in description', async () => {
    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri: 'src/myfile.ts', range: { start: 2, end: 2 }, comment: 'note', createdAt: now, updatedAt: now });

    let capturedItems: vscode.QuickPickItem[] = [];
    const orig = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = (items: vscode.QuickPickItem[]) => {
      capturedItems = items;
      return Promise.resolve(undefined);
    };

    try {
      await searchAnnotations(store);
      const item = capturedItems[0];
      assert.ok(item.description?.includes('myfile.ts'), 'Expected filename in description');
      assert.ok(item.description?.includes('Line 3'), 'Expected 1-based line number in description');
    } finally {
      (vscode.window as any).showQuickPick = orig;
    }
  });

  test('quick-pick items include tag in detail when present', async () => {
    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri: 'src/a.ts', range: { start: 0, end: 0 }, comment: 'note', tag: 'bug', createdAt: now, updatedAt: now });

    let capturedItems: vscode.QuickPickItem[] = [];
    const orig = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = (items: vscode.QuickPickItem[]) => {
      capturedItems = items;
      return Promise.resolve(undefined);
    };

    try {
      await searchAnnotations(store);
      assert.ok(capturedItems[0].detail?.includes('[bug]'), 'Expected tag in detail');
    } finally {
      (vscode.window as any).showQuickPick = orig;
    }
  });

  test('cancelling quick-pick does not throw', async () => {
    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri: 'src/foo.ts', range: { start: 0, end: 0 }, comment: 'note', createdAt: now, updatedAt: now });

    const orig = vscode.window.showQuickPick;
    (vscode.window as any).showQuickPick = () => Promise.resolve(undefined);

    try {
      await assert.doesNotReject(() => searchAnnotations(store));
    } finally {
      (vscode.window as any).showQuickPick = orig;
    }
  });
});
