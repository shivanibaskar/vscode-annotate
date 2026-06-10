import * as vscode from 'vscode';
import { AnnotationNode } from '../annotationsTreeProvider';
import { AnnotationStore } from '../annotationStore';
import { DecorationsManager } from '../decorations';
import { Annotation, HoverArg } from '../types';
import { getAnnotationAtCursor } from './utils';
import { toFileUri } from '../workspaceUtils';

/**
 * Toggles the resolved state of an annotation.
 *
 * Can be invoked from:
 * - The sidebar tree (context menu on an annotation node)
 * - The hover tooltip command link
 * - The editor context menu / keyboard chord (operates on the annotation at the cursor)
 *
 * Only the target's id is taken from the argument; the annotation itself is
 * re-fetched from the store before toggling, because CodeLens/tree arguments
 * are captured at render time and may carry stale fields that `store.update`
 * would otherwise write back wholesale.
 *
 * @param store            - The active annotation store.
 * @param decorations      - Decorations manager, refreshed when the active editor shows the file.
 * @param nodeOrAnnotation - The annotation to toggle, or undefined to resolve from cursor.
 */
export async function toggleResolved(
  store: AnnotationStore,
  decorations: DecorationsManager,
  nodeOrAnnotation?: AnnotationNode | Annotation | HoverArg
): Promise<void> {
  let id: string | undefined;

  if (nodeOrAnnotation instanceof AnnotationNode) {
    id = nodeOrAnnotation.annotation.id;
  } else if (nodeOrAnnotation && 'id' in nodeOrAnnotation) {
    id = nodeOrAnnotation.id;
  } else {
    id = (await getAnnotationAtCursor(store))?.id;
    if (!id) {
      vscode.window.showWarningMessage('Annotate: No annotation at the current cursor position.');
      return;
    }
  }

  const data = await store.load();
  const annotation = data.annotations.find(a => a.id === id);
  if (!annotation) {
    vscode.window.showWarningMessage('Annotate: Annotation not found.');
    return;
  }

  // Reopening removes the key entirely so the stored JSON stays minimal and
  // matches annotations that were never resolved.
  const { resolved: _resolved, ...base } = annotation;
  const updated: Annotation = annotation.resolved ? base : { ...base, resolved: true };
  await store.update(updated);

  const editor = vscode.window.activeTextEditor;
  if (editor && toFileUri(editor.document.uri) === annotation.fileUri) {
    await decorations.refresh(editor);
  }

  vscode.window.showInformationMessage(
    updated.resolved ? 'Annotation resolved.' : 'Annotation reopened.'
  );
}
