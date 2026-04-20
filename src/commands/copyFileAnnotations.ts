import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { Annotation } from '../types';
import { langFromPath, isProseFile } from '../langUtils';

/**
 * Formats a single annotation as a clean, clipboard-ready block.
 *
 * @param annotation - The annotation to format.
 * @param lines - All lines of the source file, used to extract code snippets.
 * @param includeContents - Whether to include the annotated source lines.
 */
function formatAnnotation(
  annotation: Annotation,
  lines: string[],
  includeContents: boolean
): string {
  const { range, comment, tag } = annotation;
  const startLine = range.start + 1;
  const endLine   = range.end + 1;
  const lineLabel = startLine === endLine ? `Line ${startLine}` : `Lines ${startLine}–${endLine}`;
  const tagLabel  = tag ? ` [${tag}]` : '';

  const parts: string[] = [`[${lineLabel}]${tagLabel}`, `${comment}`];

  if (includeContents && range.start < lines.length) {
    const snippet = lines
      .slice(range.start, Math.min(range.end + 1, lines.length))
      .join('\n');

    if (isProseFile(annotation.fileUri)) {
      parts.push('', snippet);
    } else {
      const lang = langFromPath(annotation.fileUri);
      parts.push('', `\`\`\`${lang}`, snippet, '```');
    }
  }

  parts.push('---');
  return parts.join('\n');
}

/**
 * Copies all annotations for the active editor's file to the system clipboard
 * as structured plain text, then shows a confirmation notification.
 *
 * Uses the `annotate.includeFileContents` setting to decide whether to embed
 * code snippets. Code is read from the live editor buffer (not disk), so the
 * path-traversal guard in `buildExportText` does not apply here.
 *
 * Note: `annotate.exportPreamble` and `annotate.exportContextLines` are
 * intentionally not applied — this command produces a compact, file-scoped
 * snapshot rather than a full workspace export. Use `annotate.copyToClipboard`
 * or `annotate.exportForLLM` for the full export surface with all settings.
 *
 * @param store - The active annotation store.
 */
export async function copyFileAnnotations(store: AnnotationStore): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showErrorMessage('Annotate: No active editor.');
    return;
  }

  const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
  const annotations = (await store.getForFile(relPath))
    .sort((a, b) => a.range.start - b.range.start);

  if (annotations.length === 0) {
    vscode.window.showWarningMessage(`Annotate: No annotations for ${relPath}.`);
    return;
  }

  const includeContents = vscode.workspace
    .getConfiguration('annotate')
    .get<boolean>('includeFileContents', true);

  const lines = editor.document.getText().split('\n');
  const count = annotations.length;

  const header = [
    `FILE: ${relPath}`,
    `Annotations: ${count}`,
    `Generated: ${new Date().toISOString()}`,
    '---',
  ].join('\n');

  const body = annotations
    .map(a => formatAnnotation(a, lines, includeContents))
    .join('\n');

  await vscode.env.clipboard.writeText(`${header}\n${body}`);

  vscode.window.showInformationMessage(
    `Annotate: Copied ${count} annotation${count === 1 ? '' : 's'} to clipboard.`
  );
}
