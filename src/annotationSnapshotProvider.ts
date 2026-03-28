import * as vscode from 'vscode';
import { AnnotationStore } from './annotationStore';

/**
 * URI scheme used for virtual snapshot documents.
 * Format: `annotate-snapshot://<side>/<annotationId>`
 * where `<side>` is `original` or `current`.
 */
export const SNAPSHOT_SCHEME = 'annotate-snapshot';

/**
 * TextDocumentContentProvider that serves two virtual documents per annotation:
 *
 * - `annotate-snapshot://original/<id>` — the content snapshot captured at creation
 * - `annotate-snapshot://current/<id>`  — the current lines from the live document
 *
 * Both are used by `showStaleDiff` to open VS Code's built-in diff editor.
 */
export class AnnotationSnapshotProvider implements vscode.TextDocumentContentProvider {
  constructor(private readonly store: AnnotationStore) {}

  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    // uri.authority = 'original' | 'current', uri.path = '/<annotationId>'
    const side = uri.authority as 'original' | 'current';
    const annotationId = uri.path.replace(/^\//, '');

    const data = await this.store.load();
    const annotation = data.annotations.find(a => a.id === annotationId);
    if (!annotation) {
      return '(Annotation not found)';
    }

    if (side === 'original') {
      return annotation.contentSnapshot ?? '(No snapshot — annotation predates P4.4)';
    }

    // side === 'current': read the relevant lines from the live workspace file.
    const folders = vscode.workspace.workspaceFolders;
    if (!folders?.length) {
      return '(No workspace folder open)';
    }
    try {
      const fileUri = vscode.Uri.joinPath(folders[0].uri, annotation.fileUri);
      const raw = await vscode.workspace.fs.readFile(fileUri);
      const lines = Buffer.from(raw).toString('utf8').split('\n');
      if (annotation.range.end >= lines.length) {
        return '(Lines no longer exist in file)';
      }
      return lines.slice(annotation.range.start, annotation.range.end + 1).join('\n');
    } catch {
      return '(Could not read file)';
    }
  }
}
