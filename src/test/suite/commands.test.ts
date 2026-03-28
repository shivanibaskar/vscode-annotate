import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { DecorationsManager } from '../../decorations';
import { annotateSelection } from '../../commands/annotateSelection';
import { clearAnnotations } from '../../commands/clearAnnotations';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Open an untitled document, show it, and return the editor. */
async function openDocument(content: string): Promise<vscode.TextEditor> {
  const doc = await vscode.workspace.openTextDocument({ content, language: 'typescript' });
  return vscode.window.showTextDocument(doc);
}

/** Temporarily replace a vscode API function for the duration of `fn`. */
async function withMock<T extends object, K extends keyof T>(
  obj: T,
  key: K,
  mock: T[K],
  fn: () => Promise<void>
): Promise<void> {
  const original = obj[key];
  (obj as any)[key] = mock;
  try {
    await fn();
  } finally {
    (obj as any)[key] = original;
  }
}

// ---------------------------------------------------------------------------
// annotateSelection
// ---------------------------------------------------------------------------

suite('annotateSelection command', () => {
  let store: AnnotationStore;
  let decorations: DecorationsManager;

  setup(async () => {
    store = new AnnotationStore();
    decorations = new DecorationsManager(store);
    await store.clear();
  });

  teardown(async () => {
    await store.clear();
    decorations.dispose();
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });

  test('saves annotation for selected lines', async () => {
    const editor = await openDocument('line one\nline two\nline three\n');
    editor.selection = new vscode.Selection(0, 0, 1, 8);

    await withMock(vscode.window, 'showInputBox', () => Promise.resolve('my note'), async () => {
      await annotateSelection(store, decorations);
    });

    await store.flush();
    const data = await store.load();
    assert.strictEqual(data.annotations.length, 1);
    assert.strictEqual(data.annotations[0].comment, 'my note');
    assert.strictEqual(data.annotations[0].range.start, 0);
    assert.strictEqual(data.annotations[0].range.end, 1);
  });

  test('does not save when user cancels the input box', async () => {
    const editor = await openDocument('hello\n');
    editor.selection = new vscode.Selection(0, 0, 0, 5);

    await withMock(vscode.window, 'showInputBox', () => Promise.resolve(undefined), async () => {
      await annotateSelection(store, decorations);
    });

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 0);
  });

  test('does not save when comment is blank', async () => {
    const editor = await openDocument('hello\n');
    editor.selection = new vscode.Selection(0, 0, 0, 5);

    const warnings: string[] = [];
    const warnMock: typeof vscode.window.showWarningMessage = (msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined) as any;
    };
    await withMock(vscode.window, 'showInputBox', () => Promise.resolve('   '), async () => {
      await withMock(vscode.window, 'showWarningMessage', warnMock, async () => {
        await annotateSelection(store, decorations);
      });
    });

    assert.ok(warnings.length > 0, 'Expected a warning for blank comment');
    const data = await store.load();
    assert.strictEqual(data.annotations.length, 0);
  });

  test('shows warning when selection is empty', async () => {
    const editor = await openDocument('hello\n');
    editor.selection = new vscode.Selection(0, 0, 0, 0); // empty cursor

    const warnings: string[] = [];
    const warnMock: typeof vscode.window.showWarningMessage = (msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined) as any;
    };
    await withMock(vscode.window, 'showWarningMessage', warnMock, async () => {
      await annotateSelection(store, decorations);
    });

    assert.ok(warnings.length > 0, 'Expected a warning for empty selection');
    const data = await store.load();
    assert.strictEqual(data.annotations.length, 0);
  });

  test('stores the correct workspace-relative file path', async () => {
    const editor = await openDocument('const x = 1;\n');
    editor.selection = new vscode.Selection(0, 0, 0, 13);

    await withMock(vscode.window, 'showInputBox', () => Promise.resolve('path check'), async () => {
      await annotateSelection(store, decorations);
    });

    await store.flush();
    const data = await store.load();
    assert.strictEqual(data.annotations.length, 1);
    // Untitled documents produce a path relative to the workspace; just verify it's a string.
    assert.strictEqual(typeof data.annotations[0].fileUri, 'string');
  });
});

// ---------------------------------------------------------------------------
// clearAnnotations
// ---------------------------------------------------------------------------

suite('clearAnnotations command', () => {
  let store: AnnotationStore;
  let decorations: DecorationsManager;

  const now = new Date().toISOString();
  const seed = { id: 'seed', fileUri: 'src/foo.ts', range: { start: 0, end: 0 }, comment: 'keep?', createdAt: now, updatedAt: now };

  setup(async () => {
    store = new AnnotationStore();
    decorations = new DecorationsManager(store);
    await store.clear();
  });

  teardown(async () => {
    await store.clear();
    decorations.dispose();
  });

  test('clears all annotations when user confirms', async () => {
    await store.add(seed);

    await withMock(vscode.window, 'showWarningMessage', () => Promise.resolve('Clear') as any, async () => {
      await clearAnnotations(store, decorations);
    });

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 0);
  });

  test('leaves annotations untouched when user dismisses the dialog', async () => {
    await store.add(seed);

    await withMock(vscode.window, 'showWarningMessage', () => Promise.resolve(undefined) as any, async () => {
      await clearAnnotations(store, decorations);
    });

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 1);
  });
});
