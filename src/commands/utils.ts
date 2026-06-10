import * as vscode from 'vscode';
import { Annotation } from '../types';
import { AnnotationStore } from '../annotationStore';
import { toFileUri } from '../workspaceUtils';

/**
 * Returns the first annotation whose range covers the active editor's cursor line,
 * sorted by start line ascending (matching the sidebar order).
 * Returns undefined when there is no active editor or no annotation at the cursor.
 *
 * Deliberately line-based (not character-precise): edit/delete-at-cursor via
 * keyboard should work with the cursor anywhere on an annotated line, since
 * the cursor often sits outside the annotated character span.
 */
export async function getAnnotationAtCursor(
  store: AnnotationStore
): Promise<Annotation | undefined> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) { return undefined; }

  const relPath = toFileUri(editor.document.uri);
  const cursorLine = editor.selection.active.line;
  const annotations = await store.getForFile(relPath);

  return annotations
    .filter(a => cursorLine >= a.range.start && cursorLine <= a.range.end)
    .sort((a, b) => a.range.start - b.range.start)[0];
}
