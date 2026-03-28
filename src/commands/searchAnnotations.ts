import * as path from 'path';
import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { Annotation } from '../types';

interface AnnotationQuickPickItem extends vscode.QuickPickItem {
  annotation: Annotation;
}

function lineLabel(start: number, end: number): string {
  const s = start + 1;
  const e = end + 1;
  return s === e ? `Line ${s}` : `Lines ${s}–${e}`;
}

export async function searchAnnotations(store: AnnotationStore): Promise<void> {
  const data = await store.load();

  if (data.annotations.length === 0) {
    vscode.window.showWarningMessage('Annotate: No annotations to search.');
    return;
  }

  const items: AnnotationQuickPickItem[] = data.annotations
    .sort((a, b) => a.fileUri.localeCompare(b.fileUri) || a.range.start - b.range.start)
    .map(ann => ({
      label: ann.comment,
      description: `${path.basename(ann.fileUri)} · ${lineLabel(ann.range.start, ann.range.end)}`,
      detail: ann.tag ? `[${ann.tag}]  ${ann.fileUri}` : ann.fileUri,
      annotation: ann,
    }));

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Search annotations…',
    matchOnDescription: true,
    matchOnDetail: true,
    ignoreFocusOut: false,
  });

  if (!pick) { return; }

  const annotation = pick.annotation;
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) { return; }

  const uri = vscode.Uri.joinPath(folders[0].uri, annotation.fileUri);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);

  const range = new vscode.Range(
    new vscode.Position(annotation.range.start, 0),
    new vscode.Position(annotation.range.end, Number.MAX_SAFE_INTEGER)
  );
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  editor.selection = new vscode.Selection(range.start, range.end);
}
