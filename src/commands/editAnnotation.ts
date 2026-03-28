import * as vscode from 'vscode';
import { AnnotationNode } from '../annotationsTreeProvider';
import { AnnotationStore } from '../annotationStore';
import { DecorationsManager } from '../decorations';
import { Annotation, AnnotationTag } from '../types';
import { getAnnotationAtCursor } from './utils';

const TAG_ITEMS: { label: string; tag: AnnotationTag | undefined }[] = [
  { label: '$(circle-slash) None',     tag: undefined },
  { label: '$(bug) Bug',               tag: 'bug' },
  { label: '$(info) Context',          tag: 'context' },
  { label: '$(question) Question',     tag: 'question' },
  { label: '$(check) Todo',            tag: 'todo' },
  { label: '$(star) Important',        tag: 'important' },
];

export async function editAnnotation(
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

  const newComment = await vscode.window.showInputBox({
    prompt: 'Edit annotation comment',
    value: annotation.comment,
    valueSelection: [0, annotation.comment.length],
    ignoreFocusOut: true,
  });

  if (newComment === undefined) {
    return; // user cancelled
  }
  if (newComment.trim() === '') {
    vscode.window.showWarningMessage('Annotate: Comment cannot be empty.');
    return;
  }

  const tagPick = await vscode.window.showQuickPick(TAG_ITEMS, {
    placeHolder: `Select a tag (current: ${annotation.tag ?? 'none'})`,
    ignoreFocusOut: true,
  });
  if (tagPick === undefined) {
    return; // user cancelled
  }

  const updated: Annotation = { ...annotation, comment: newComment.trim() };
  if (tagPick.tag) { updated.tag = tagPick.tag; } else { delete updated.tag; }
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
