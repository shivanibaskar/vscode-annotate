import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { buildExportText } from './buildExportText';

/**
 * Builds the full LLM export text using the active template and settings,
 * writes it directly to the system clipboard, and shows a confirmation toast.
 *
 * Exports all annotations in the workspace — use `annotate.exportForLLM` when
 * a preview before copying is needed, or `annotate.copyFileAnnotations` to
 * copy only the active file's annotations.
 *
 * @param store - The active annotation store.
 */
export async function copyToClipboard(store: AnnotationStore): Promise<void> {
  const data = await store.load();
  const count = data.annotations.length;

  if (count === 0) {
    vscode.window.showWarningMessage('Annotate: No annotations to copy.');
    return;
  }

  const text = await buildExportText(store);
  // Guard against an unlikely race where annotations are cleared between
  // the count check above and the buildExportText call.
  if (!text) { return; }

  await vscode.env.clipboard.writeText(text);
  vscode.window.showInformationMessage(
    `Annotate: ${count} annotation${count === 1 ? '' : 's'} copied to clipboard.`
  );
}
