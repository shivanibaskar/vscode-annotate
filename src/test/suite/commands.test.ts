import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { DecorationsManager } from '../../decorations';
import { AnnotationNode } from '../../annotationsTreeProvider';
import { annotateSelection } from '../../commands/annotateSelection';
import { clearAnnotations } from '../../commands/clearAnnotations';
import { editAnnotation } from '../../commands/editAnnotation';
import { deleteAnnotation } from '../../commands/deleteAnnotation';
import * as annotationInputModule from '../../ui/annotationInput';
import { AnnotationTag } from '../../types';

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

type InputResult = { comment: string; tag: AnnotationTag | undefined } | undefined;

/**
 * Temporarily replace `showAnnotationInput` with a mock that returns the
 * given result, then runs `fn`.
 */
async function withInputMock(result: InputResult, fn: () => Promise<void>): Promise<void> {
  const original = annotationInputModule.showAnnotationInput;
  (annotationInputModule as any).showAnnotationInput = () => Promise.resolve(result);
  try {
    await fn();
  } finally {
    (annotationInputModule as any).showAnnotationInput = original;
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

    await withInputMock({ comment: 'my note', tag: undefined }, async () => {
      await annotateSelection(store, decorations);
    });

    await store.flush();
    const data = await store.load();
    assert.strictEqual(data.annotations.length, 1);
    assert.strictEqual(data.annotations[0].comment, 'my note');
    assert.strictEqual(data.annotations[0].range.start, 0);
    assert.strictEqual(data.annotations[0].range.end, 1);
  });

  test('saves annotation with selected tag', async () => {
    const editor = await openDocument('const x = 1;\n');
    editor.selection = new vscode.Selection(0, 0, 0, 13);

    await withInputMock({ comment: 'found a bug', tag: 'bug' }, async () => {
      await annotateSelection(store, decorations);
    });

    await store.flush();
    const data = await store.load();
    assert.strictEqual(data.annotations[0].tag, 'bug');
  });

  test('does not save when user cancels (returns undefined)', async () => {
    const editor = await openDocument('hello\n');
    editor.selection = new vscode.Selection(0, 0, 0, 5);

    await withInputMock(undefined, async () => {
      await annotateSelection(store, decorations);
    });

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 0);
  });

  test('does not save when comment is empty string', async () => {
    const editor = await openDocument('hello\n');
    editor.selection = new vscode.Selection(0, 0, 0, 5);

    const warnings: string[] = [];
    const warnMock: typeof vscode.window.showWarningMessage = (msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined) as any;
    };
    await withInputMock({ comment: '', tag: undefined }, async () => {
      await withMock(vscode.window, 'showWarningMessage', warnMock, async () => {
        await annotateSelection(store, decorations);
      });
    });

    assert.ok(warnings.length > 0, 'Expected a warning for empty comment');
    const data = await store.load();
    assert.strictEqual(data.annotations.length, 0);
  });

  test('shows warning when selection is empty', async () => {
    const editor = await openDocument('hello\n');
    editor.selection = new vscode.Selection(0, 0, 0, 0);

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

    await withInputMock({ comment: 'path check', tag: undefined }, async () => {
      await annotateSelection(store, decorations);
    });

    await store.flush();
    const data = await store.load();
    assert.strictEqual(data.annotations.length, 1);
    assert.strictEqual(typeof data.annotations[0].fileUri, 'string');
  });

  test('captures contentSnapshot of selected lines', async () => {
    const editor = await openDocument('alpha\nbeta\ngamma\n');
    // Select lines 0–1 ("alpha" and "beta")
    editor.selection = new vscode.Selection(0, 0, 1, 4);

    await withInputMock({ comment: 'snapshot test', tag: undefined }, async () => {
      await annotateSelection(store, decorations);
    });

    await store.flush();
    const data = await store.load();
    assert.strictEqual(data.annotations.length, 1);
    assert.ok(
      data.annotations[0].contentSnapshot !== undefined,
      'Expected contentSnapshot to be set'
    );
    assert.ok(
      data.annotations[0].contentSnapshot!.includes('alpha'),
      'Snapshot should contain first selected line'
    );
    assert.ok(
      data.annotations[0].contentSnapshot!.includes('beta'),
      'Snapshot should contain second selected line'
    );
  });

  test('annotates a markdown file and stores the annotation', async () => {
    const doc = await vscode.workspace.openTextDocument({
      content: '# Heading\n\nThis is a paragraph.\n',
      language: 'markdown',
    });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(0, 0, 0, 9); // "# Heading"

    await withInputMock({ comment: 'intro heading', tag: 'context' }, async () => {
      await annotateSelection(store, decorations);
    });

    await store.flush();
    const data = await store.load();
    assert.strictEqual(data.annotations.length, 1);
    assert.strictEqual(data.annotations[0].comment, 'intro heading');
    assert.strictEqual(data.annotations[0].tag, 'context');
    assert.ok(data.annotations[0].contentSnapshot?.includes('# Heading'));
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

// ---------------------------------------------------------------------------
// deleteAnnotation
// ---------------------------------------------------------------------------

suite('deleteAnnotation command', () => {
  let store: AnnotationStore;
  let decorations: DecorationsManager;
  const now = new Date().toISOString();

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

  test('removes annotation when AnnotationNode is provided', async () => {
    const ann1 = { id: 'del-1', fileUri: 'src/foo.ts', range: { start: 0, end: 0 }, comment: 'keep',   createdAt: now, updatedAt: now };
    const ann2 = { id: 'del-2', fileUri: 'src/foo.ts', range: { start: 2, end: 2 }, comment: 'remove', createdAt: now, updatedAt: now };
    await store.add(ann1);
    await store.add(ann2);

    const node = new AnnotationNode(ann2);
    await withMock(vscode.window, 'showInformationMessage', () => Promise.resolve(undefined) as any, async () => {
      await deleteAnnotation(store, decorations, node);
    });

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 1);
    assert.strictEqual(data.annotations[0].id, 'del-1');
  });

  test('shows warning when no node and no annotation at cursor', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'hello\n' });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(0, 0, 0, 0);

    const warnings: string[] = [];
    const warnMock: typeof vscode.window.showWarningMessage = (msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined) as any;
    };
    await withMock(vscode.window, 'showWarningMessage', warnMock, async () => {
      await deleteAnnotation(store, decorations, undefined);
    });

    assert.ok(warnings.length > 0, 'Expected warning');
    assert.strictEqual((await store.load()).annotations.length, 0);
  });

  test('removes annotation at cursor position when no node provided', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'line 0\nline 1\nline 2\n' });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(1, 0, 1, 0);

    const fileUri = vscode.workspace.asRelativePath(editor.document.uri, false);
    await store.add({ id: 'at-cursor', fileUri, range: { start: 0, end: 2 }, comment: 'here', createdAt: now, updatedAt: now });

    await withMock(vscode.window, 'showInformationMessage', () => Promise.resolve(undefined) as any, async () => {
      await deleteAnnotation(store, decorations, undefined);
    });

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 0);
  });
});

// ---------------------------------------------------------------------------
// editAnnotation
// ---------------------------------------------------------------------------

suite('editAnnotation command', () => {
  let store: AnnotationStore;
  let decorations: DecorationsManager;
  const now = new Date().toISOString();

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

  test('updates comment when AnnotationNode is provided', async () => {
    const ann = { id: 'edit-1', fileUri: 'src/foo.ts', range: { start: 0, end: 0 }, comment: 'original', createdAt: now, updatedAt: now };
    await store.add(ann);

    const node = new AnnotationNode(ann);
    await withInputMock({ comment: 'edited comment', tag: undefined }, async () => {
      await withMock(vscode.window, 'showInformationMessage', () => Promise.resolve(undefined) as any, async () => {
        await editAnnotation(store, decorations, node);
      });
    });

    await store.flush();
    const data = await store.load();
    assert.strictEqual(data.annotations[0].comment, 'edited comment');
    assert.strictEqual(data.annotations[0].id, 'edit-1');
  });

  test('updates tag when a tag is selected', async () => {
    const ann = { id: 'edit-tag', fileUri: 'src/foo.ts', range: { start: 0, end: 0 }, comment: 'check', createdAt: now, updatedAt: now };
    await store.add(ann);

    const node = new AnnotationNode(ann);
    await withInputMock({ comment: 'check', tag: 'question' }, async () => {
      await withMock(vscode.window, 'showInformationMessage', () => Promise.resolve(undefined) as any, async () => {
        await editAnnotation(store, decorations, node);
      });
    });

    await store.flush();
    const data = await store.load();
    assert.strictEqual(data.annotations[0].tag, 'question');
  });

  test('clears tag when "No tag" is selected', async () => {
    const ann = { id: 'edit-clr', fileUri: 'src/foo.ts', range: { start: 0, end: 0 }, comment: 'check', tag: 'bug' as const, createdAt: now, updatedAt: now };
    await store.add(ann);

    const node = new AnnotationNode(ann);
    await withInputMock({ comment: 'check', tag: undefined }, async () => {
      await withMock(vscode.window, 'showInformationMessage', () => Promise.resolve(undefined) as any, async () => {
        await editAnnotation(store, decorations, node);
      });
    });

    await store.flush();
    const data = await store.load();
    assert.strictEqual(data.annotations[0].tag, undefined);
  });

  test('does not update when user cancels', async () => {
    const ann = { id: 'edit-2', fileUri: 'src/foo.ts', range: { start: 0, end: 0 }, comment: 'original', createdAt: now, updatedAt: now };
    await store.add(ann);

    const node = new AnnotationNode(ann);
    await withInputMock(undefined, async () => {
      await editAnnotation(store, decorations, node);
    });

    const data = await store.load();
    assert.strictEqual(data.annotations[0].comment, 'original');
  });

  test('does not update when empty comment is submitted', async () => {
    const ann = { id: 'edit-3', fileUri: 'src/foo.ts', range: { start: 0, end: 0 }, comment: 'original', createdAt: now, updatedAt: now };
    await store.add(ann);

    const node = new AnnotationNode(ann);
    const warnings: string[] = [];
    const warnMock: typeof vscode.window.showWarningMessage = (msg: string) => {
      warnings.push(msg);
      return Promise.resolve(undefined) as any;
    };
    await withInputMock({ comment: '', tag: undefined }, async () => {
      await withMock(vscode.window, 'showWarningMessage', warnMock, async () => {
        await editAnnotation(store, decorations, node);
      });
    });

    assert.ok(warnings.length > 0, 'Expected warning for empty comment');
    const data = await store.load();
    assert.strictEqual(data.annotations[0].comment, 'original');
  });

  test('updates annotation at cursor position when no node provided', async () => {
    const doc = await vscode.workspace.openTextDocument({ content: 'line 0\nline 1\n' });
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(0, 0, 0, 0);

    const fileUri = vscode.workspace.asRelativePath(editor.document.uri, false);
    const ann = { id: 'cursor-edit', fileUri, range: { start: 0, end: 1 }, comment: 'old', createdAt: now, updatedAt: now };
    await store.add(ann);

    await withInputMock({ comment: 'new comment', tag: undefined }, async () => {
      await withMock(vscode.window, 'showInformationMessage', () => Promise.resolve(undefined) as any, async () => {
        await editAnnotation(store, decorations, undefined);
      });
    });

    await store.flush();
    const data = await store.load();
    assert.strictEqual(data.annotations[0].comment, 'new comment');
  });
});
