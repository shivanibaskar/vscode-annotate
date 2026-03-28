import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { AnnotationStore } from '../annotationStore';
import { DecorationsManager } from '../decorations';
import { showAnnotationInput } from '../ui/annotationInput';

export async function annotateSelection(
  store: AnnotationStore,
  decorations: DecorationsManager
): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Annotate: No active editor.');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showWarningMessage('Annotate: Select some lines first.');
    return;
  }

  const result = await showAnnotationInput({ title: 'New Annotation' });

  if (result === undefined) {
    return; // user cancelled (closed the picker)
  }
  if (result.comment === '') {
    vscode.window.showWarningMessage('Annotate: Comment cannot be empty.');
    return;
  }

  const fileUri = vscode.workspace.asRelativePath(editor.document.uri, false);
  const now = new Date().toISOString();

  // If selection ends at column 0, the last line isn't really included.
  let endLine = selection.end.line;
  if (selection.end.character === 0 && endLine > selection.start.line) {
    endLine -= 1;
  }

  await store.add({
    id: uuidv4(),
    fileUri,
    range: {
      start: selection.start.line,
      end: endLine,
      startChar: selection.start.character,
      endChar: selection.end.character,
    },
    comment: result.comment,
    ...(result.tag ? { tag: result.tag } : {}),
    createdAt: now,
    updatedAt: now,
  });

  await decorations.refresh(editor);
  vscode.window.showInformationMessage('Annotation saved.');
}
