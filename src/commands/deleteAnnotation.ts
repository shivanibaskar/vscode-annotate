import * as vscode from 'vscode';
import { AnnotationNode } from '../annotationsTreeProvider';
import { AnnotationStore } from '../annotationStore';
import { DecorationsManager } from '../decorations';
import { Annotation } from '../types';
import { getAnnotationAtCursor } from './utils';

export async function deleteAnnotation(
  store: AnnotationStore,
  decorations: DecorationsManager,
  nodeOrAnnotation: AnnotationNode | Annotation | undefined
): Promise<void> {
  let annotation: Annotation | undefined;

  if (nodeOrAnnotation instanceof AnnotationNode) {
    annotation = nodeOrAnnotation.annotation;
  } else if (nodeOrAnnotation && 'id' in nodeOrAnnotation) {
    // Called from hover command link — annotation object passed directly as arg
    annotation = nodeOrAnnotation;
  } else {
    annotation = await getAnnotationAtCursor(store);
    if (!annotation) {
      vscode.window.showWarningMessage('Annotate: No annotation at the current cursor position.');
      return;
    }
  }

  await store.remove(annotation.id);

  const editor = vscode.window.activeTextEditor;
  if (editor) {
    const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
    if (relPath === annotation.fileUri) {
      await decorations.refresh(editor);
    }
  }

  vscode.window.showInformationMessage('Annotation deleted.');
}
