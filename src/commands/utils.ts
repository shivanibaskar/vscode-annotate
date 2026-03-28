import * as vscode from 'vscode';
import { Annotation } from '../types';
import { AnnotationStore } from '../annotationStore';

/**
 * Returns the first annotation whose range covers the active editor's cursor line,
 * sorted by start line ascending (matching the sidebar order).
 * Returns undefined when there is no active editor or no annotation at the cursor.
 */
export async function getAnnotationAtCursor(
  store: AnnotationStore
): Promise<Annotation | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return undefined; }

  const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
  const cursorLine = editor.selection.active.line;
  const annotations = await store.getForFile(relPath);

  return annotations
    .filter(a => cursorLine >= a.range.start && cursorLine <= a.range.end)
    .sort((a, b) => a.range.start - b.range.start)[0];
}
