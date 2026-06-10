import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { DecorationsManager } from '../decorations';
import { GitBranchWatcher } from '../gitBranchWatcher';

/**
 * Switches the active annotation set to the current git branch name.
 * If the branch cannot be determined, falls back to prompting the user.
 *
 * @param store       - The active annotation store.
 * @param decorations - Decorations manager, refreshed after the set switch.
 * @param watcher     - Git branch watcher used to read the current branch.
 * @param onSwitch    - Optional callback fired after a successful switch (e.g. to update UI titles).
 */
export async function syncWithBranch(
  store: AnnotationStore,
  decorations: DecorationsManager,
  watcher: GitBranchWatcher,
  onSwitch?: (name: string) => void
): Promise<void> {
  const branch = watcher.currentBranch;

  if (!branch) {
    vscode.window.showWarningMessage(
      'Annotate: Could not determine the current git branch. ' +
      'Make sure this workspace is inside a git repository.'
    );
    return;
  }

  // Sanitise branch name into a valid set name (inverse of SET_NAME_PATTERN):
  // every disallowed character becomes '-' so e.g. "release/1.2.0" → "release-1.2.0"
  // and "feat_x" survives unchanged.
  const setName = branch.replace(/[^a-zA-Z0-9._-]/g, '-');

  if (store.setName === setName) {
    vscode.window.showInformationMessage(
      `Annotate: Already using annotation set "${setName}" for branch "${branch}".`
    );
    return;
  }

  store.switchSet(setName);
  onSwitch?.(setName);

  for (const editor of vscode.window.visibleTextEditors) {
    await decorations.refresh(editor);
  }

  vscode.window.showInformationMessage(
    `Annotate: Switched to annotation set "${setName}" for branch "${branch}".`
  );
}
