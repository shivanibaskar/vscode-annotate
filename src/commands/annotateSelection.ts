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
  // Empty comment is already prevented by showAnnotationInput's InputBox validator.

  const fileUri = vscode.workspace.asRelativePath(editor.document.uri, false);
  const now = new Date().toISOString();

  // If selection ends at column 0, the last line isn't really included —
  // drop it and extend endChar to the end of the previous line so the stored
  // range covers everything the user actually selected.
  let endLine = selection.end.line;
  let endChar = selection.end.character;
  if (endChar === 0 && endLine > selection.start.line) {
    endLine -= 1;
    endChar = editor.document.lineAt(endLine).text.length;
  }

  // Capture the exact text of the annotated lines so we can detect staleness later.
  // Must stay whole-line: isAnnotationStale compares against whole document lines.
  const snapshotRange = new vscode.Range(
    new vscode.Position(selection.start.line, 0),
    new vscode.Position(endLine, Number.MAX_SAFE_INTEGER)
  );
  const contentSnapshot = editor.document.getText(snapshotRange);

  await store.add({
    id: uuidv4(),
    fileUri,
    range: {
      start: selection.start.line,
      end: endLine,
      startChar: selection.start.character,
      endChar,
    },
    comment: result.comment,
    ...(result.tag ? { tag: result.tag } : {}),
    contentSnapshot,
    createdAt: now,
    updatedAt: now,
  });

  await decorations.refresh(editor);
  vscode.window.showInformationMessage('Annotation saved.');
}
