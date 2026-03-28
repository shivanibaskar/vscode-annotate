import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { ExportPreviewPanel } from '../panels/exportPreviewPanel';
import { buildExportText } from './buildExportText';

export async function exportForLLM(store: AnnotationStore): Promise<void> {
  const output = await buildExportText(store);

  if (output === null) {
    vscode.window.showWarningMessage('Annotate: No annotations to export.');
    return;
  }

  ExportPreviewPanel.show(output);
}
