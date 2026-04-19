import * as vscode from 'vscode';
import { AnnotationNode } from '../annotationsTreeProvider';
import { AnnotationStore } from '../annotationStore';
import { DecorationsManager } from '../decorations';
import { Annotation, HoverArg } from '../types';
import { getAnnotationAtCursor } from './utils';

export async function deleteAnnotation(
  store: AnnotationStore,
  decorations: DecorationsManager,
  nodeOrAnnotation: AnnotationNode | Annotation | HoverArg | undefined
): Promise<void> {
  let annotation: Annotation | undefined;

  if (nodeOrAnnotation instanceof AnnotationNode) {
    annotation = nodeOrAnnotation.annotation;
  } else if (nodeOrAnnotation && 'id' in nodeOrAnnotation) {
    if ('comment' in nodeOrAnnotation) {
      annotation = nodeOrAnnotation as Annotation;
    } else {
      // Hover command link passes only { id } — look up the full annotation.
      const data = await store.load();
      annotation = data.annotations.find(a => a.id === (nodeOrAnnotation as HoverArg).id);
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
