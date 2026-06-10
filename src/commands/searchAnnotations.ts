import * as path from 'path';
import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { Annotation } from '../types';
import { annotationToRange } from '../rangeUtils';
import { resolveFileUri } from '../workspaceUtils';

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
      description: `${path.basename(ann.fileUri)} · ${lineLabel(ann.range.start, ann.range.end)}` +
        (ann.resolved ? ' · ✓ resolved' : ''),
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
  const uri = resolveFileUri(annotation.fileUri);
  if (!uri) { return; }

  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);

  // Character-precise so the selection matches exactly what was annotated.
  const range = annotationToRange(annotation);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  editor.selection = new vscode.Selection(range.start, range.end);
}
