import * as vscode from 'vscode';
import { AnnotationNode } from '../annotationsTreeProvider';
import { AnnotationStore } from '../annotationStore';
import { DecorationsManager } from '../decorations';
import { Annotation } from '../types';
import { getAnnotationAtCursor } from './utils';
import { showAnnotationInput } from '../ui/annotationInput';

export async function editAnnotation(
  store: AnnotationStore,
  decorations: DecorationsManager,
  nodeOrAnnotation: AnnotationNode | Annotation | undefined
): Promise<void> {
  let annotation: Annotation | undefined;

  if (nodeOrAnnotation instanceof AnnotationNode) {
    annotation = nodeOrAnnotation.annotation;
  } else if (nodeOrAnnotation && 'id' in nodeOrAnnotation) {
    if ('comment' in nodeOrAnnotation) {
      // Full Annotation passed (e.g. from programmatic callers).
      annotation = nodeOrAnnotation as Annotation;
    } else {
      // Hover command link passes only { id } — look up the full annotation.
      const data = await store.load();
      annotation = data.annotations.find(a => a.id === (nodeOrAnnotation as { id: string }).id);
      if (!annotation) {
        vscode.window.showWarningMessage('Annotate: Annotation not found.');
        return;
      }
    }
  } else {
    annotation = await getAnnotationAtCursor(store);
    if (!annotation) {
      vscode.window.showWarningMessage('Annotate: No annotation at the current cursor position.');
      return;
    }
  }

  const result = await showAnnotationInput({
    title: 'Edit Annotation',
    initialComment: annotation.comment,
    initialTag: annotation.tag,
  });

  if (result === undefined) {
    return; // user cancelled
  }

  // Build the updated annotation in one expression — avoids mutating a spread
  // copy via `delete` and keeps TypeScript's type narrowing intact.
  const { tag: _tag, ...base } = annotation;
  const updated: Annotation = {
    ...base,
    comment: result.comment,
    ...(result.tag ? { tag: result.tag } : {}),
  };
  await store.update(updated);

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
    if (relPath === annotation.fileUri) {
      await decorations.refresh(editor);
    }
  }

  vscode.window.showInformationMessage('Annotation updated.');
}
