import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { DecorationsManager } from '../decorations';
import { AnnotationsFile } from '../types';

/**
 * Clears annotations for either the active file or the whole workspace,
 * then offers a 10-second undo window.
 *
 * @param store        - The active annotation store.
 * @param decorations  - Decorations manager for refreshing editor gutters.
 * @param activeEditor - The currently active text editor. When provided, the
 *                       "Clear This File" option is shown in the modal.
 */
export async function clearAnnotations(
  store: AnnotationStore,
  decorations: DecorationsManager,
  activeEditor?: vscode.TextEditor
): Promise<void> {
  type ClearItem = vscode.QuickPickItem & { action: 'file' | 'workspace' };

  const items: ClearItem[] = [];

  if (activeEditor) {
    const relPath = vscode.workspace.asRelativePath(activeEditor.document.uri, false);
    items.push({
      label:       '$(file) Clear This File',
      description: relPath,
      detail:      'Remove annotations only from the currently open file.',
      action:      'file',
    });
  }

  items.push({
    label:  '$(trash) Clear Workspace',
    detail: 'Remove all annotations across every file in this workspace.',
    action: 'workspace',
  });

  const pick = await vscode.window.showQuickPick(items, {
    title:       'Clear Annotations',
    placeHolder: 'Select a scope — press Escape to cancel',
    ignoreFocusOut: false,
  });

  if (!pick) { return; }

  if (pick.action === 'file') {
    await clearFile(store, decorations, activeEditor!);
  } else {
    await clearWorkspace(store, decorations);
  }
}

async function clearFile(
  store: AnnotationStore,
  decorations: DecorationsManager,
  editor: vscode.TextEditor
): Promise<void> {
  const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
  const data = await store.load();
  const fileAnns = data.annotations.filter(a => a.fileUri === relPath);

  if (fileAnns.length === 0) {
    vscode.window.showInformationMessage('No annotations in this file.');
    return;
  }

  // Snapshot before clearing for undo.
  const snapshot: AnnotationsFile = { version: 1, annotations: [...data.annotations] };

  await store.save({
    version: 1,
    annotations: data.annotations.filter(a => a.fileUri !== relPath),
  });
  await decorations.refresh(editor);

  const count = fileAnns.length;
  const msg = count === 1 ? 'Cleared 1 annotation from this file.' : `Cleared ${count} annotations from this file.`;
  const undoChoice = await undoRace(msg);
  if (undoChoice === 'Undo') {
    await store.save(snapshot);
    await decorations.refresh(editor);
  }
}

async function clearWorkspace(
  store: AnnotationStore,
  decorations: DecorationsManager
): Promise<void> {
  const data = await store.load();

  if (data.annotations.length === 0) {
    vscode.window.showInformationMessage('No annotations to clear.');
    return;
  }

  // Snapshot before clearing for undo.
  const snapshot: AnnotationsFile = { version: 1, annotations: [...data.annotations] };

  await store.clear();
  decorations.clearAll();

  const undoChoice = await undoRace('All annotations cleared.');
  if (undoChoice === 'Undo') {
    await store.save(snapshot);
    await decorations.refreshAll();
  }
}

/**
 * Shows an information message with an "Undo" button and races it against
 * a 10-second timeout. Returns 'Undo' if clicked within the window,
 * undefined otherwise.
 */
function undoRace(message: string): Promise<string | undefined> {
  return Promise.race([
    vscode.window.showInformationMessage(message, 'Undo'),
    new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 10_000)),
  ]);
}
