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
    // Called from hover command link — annotation object passed directly as arg.
    annotation = nodeOrAnnotation;
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
  if (result.comment === '') {
    vscode.window.showWarningMessage('Annotate: Comment cannot be empty.');
    return;
  }

  const updated: Annotation = { ...annotation, comment: result.comment };
  if (result.tag) { updated.tag = result.tag; } else { delete updated.tag; }
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
