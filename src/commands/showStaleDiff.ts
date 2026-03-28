import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { AnnotationNode } from '../annotationsTreeProvider';
import { Annotation } from '../types';
import { isAnnotationStale } from '../staleDetector';
import { SNAPSHOT_SCHEME } from '../annotationSnapshotProvider';

/**
 * Opens VS Code's diff editor showing the original snapshot of an annotation
 * alongside the current content of those lines.
 *
 * Can be invoked from:
 * - The sidebar tree (right-click on a stale annotation node)
 * - The hover tooltip command link
 * - The command palette (operates on the annotation at the cursor)
 *
 * @param store              - The active annotation store.
 * @param nodeOrAnnotation   - The annotation to diff, or undefined to resolve from cursor.
 */
export async function showStaleDiff(
  store: AnnotationStore,
  nodeOrAnnotation?: AnnotationNode | Annotation
): Promise<void> {
  let annotation: Annotation | undefined;

  if (nodeOrAnnotation instanceof AnnotationNode) {
    annotation = nodeOrAnnotation.annotation;
  } else if (nodeOrAnnotation) {
    annotation = nodeOrAnnotation as Annotation;
  } else {
    // Resolve from cursor position in the active editor.
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage('Annotate: No active editor.');
      return;
    }
    const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
    const cursorLine = editor.selection.active.line;
    const data = await store.load();
    annotation = data.annotations.find(
      a => a.fileUri === relPath &&
           cursorLine >= a.range.start &&
           cursorLine <= a.range.end
    );
    if (!annotation) {
      vscode.window.showWarningMessage('Annotate: No annotation found at cursor position.');
      return;
    }
  }

  if (!annotation.contentSnapshot) {
    vscode.window.showInformationMessage(
      'Annotate: This annotation has no content snapshot. ' +
      'Re-annotate the selection to enable staleness diffing.'
    );
    return;
  }

  // Check whether it is actually stale before opening the diff.
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length) {
    try {
      const fileUri = vscode.Uri.joinPath(folders[0].uri, annotation.fileUri);
      const raw = await vscode.workspace.fs.readFile(fileUri);
      const docText = Buffer.from(raw).toString('utf8');
      if (!isAnnotationStale(annotation, docText)) {
        vscode.window.showInformationMessage(
          'Annotate: This annotation is not stale — the source lines have not changed.'
        );
        return;
      }
    } catch {
      // File may have been deleted; proceed to show diff anyway.
    }
  }

  const startLine = annotation.range.start + 1; // 1-based for display
  const endLine   = annotation.range.end + 1;
  const lineLabel = startLine === endLine ? `line ${startLine}` : `lines ${startLine}–${endLine}`;
  const title = `Stale Annotation — ${annotation.fileUri} ${lineLabel}`;

  const originalUri = vscode.Uri.from({
    scheme: SNAPSHOT_SCHEME,
    authority: 'original',
    path: `/${annotation.id}`,
  });
  const currentUri = vscode.Uri.from({
    scheme: SNAPSHOT_SCHEME,
    authority: 'current',
    path: `/${annotation.id}`,
  });

  await vscode.commands.executeCommand('vscode.diff', originalUri, currentUri, title);
}
