import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { DecorationsManager } from '../../decorations';
import { GitBranchWatcher } from '../../gitBranchWatcher';
import { syncWithBranch } from '../../commands/syncWithBranch';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal stub that satisfies the GitBranchWatcher interface used by syncWithBranch. */
function makeWatcherStub(branch: string | undefined): GitBranchWatcher {
  return { currentBranch: branch } as unknown as GitBranchWatcher;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('syncWithBranch command', () => {
  let store: AnnotationStore;
  let decorations: DecorationsManager;
  const infos: string[] = [];
  const warnings: string[] = [];

  setup(async () => {
    store = new AnnotationStore();
    decorations = new DecorationsManager(store);
    await store.clear();
    infos.length = 0;
    warnings.length = 0;

    const origInfo = vscode.window.showInformationMessage;
    const origWarn = vscode.window.showWarningMessage;
    (vscode.window as any).showInformationMessage = (msg: string) => { infos.push(msg); return Promise.resolve(undefined); };
    (vscode.window as any).showWarningMessage    = (msg: string) => { warnings.push(msg); return Promise.resolve(undefined); };

    // Restore after each test via teardown.
    (suite as any)._origInfo = origInfo;
    (suite as any)._origWarn = origWarn;
  });

  teardown(async () => {
    (vscode.window as any).showInformationMessage = (suite as any)._origInfo;
    (vscode.window as any).showWarningMessage     = (suite as any)._origWarn;
    decorations.dispose();
    await store.clear();
  });

  test('shows warning when no branch can be determined', async () => {
    await syncWithBranch(store, decorations, makeWatcherStub(undefined));
    assert.ok(warnings.some(w => w.includes('Could not determine')), 'Expected warning about missing branch');
    assert.strictEqual(store.setName, 'default', 'Set name should remain default');
  });

  test('switches annotation set to the branch name', async () => {
    await syncWithBranch(store, decorations, makeWatcherStub('main'));
    assert.strictEqual(store.setName, 'main');
    assert.ok(infos.some(m => m.includes('"main"')), 'Expected confirmation message');
  });

  test('sanitises forward slashes in branch names', async () => {
    await syncWithBranch(store, decorations, makeWatcherStub('feature/auth-refactor'));
    assert.strictEqual(store.setName, 'feature-auth-refactor');
  });

  test('sanitises backslashes in branch names', async () => {
    await syncWithBranch(store, decorations, makeWatcherStub('feature\\windows'));
    assert.strictEqual(store.setName, 'feature-windows');
  });

  test('shows "already using" message when set matches branch', async () => {
    store.switchSet('my-branch');
    await syncWithBranch(store, decorations, makeWatcherStub('my-branch'));
    assert.ok(infos.some(m => m.includes('Already using')), 'Expected already-using message');
    assert.strictEqual(store.setName, 'my-branch', 'Set name should not change');
  });

  test('fires onSwitch callback with sanitised set name', async () => {
    let callbackName: string | undefined;
    await syncWithBranch(store, decorations, makeWatcherStub('feat/x'), name => {
      callbackName = name;
    });
    assert.strictEqual(callbackName, 'feat-x');
  });
});
