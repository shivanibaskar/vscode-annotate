import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { ExportPreviewPanel } from '../panels/exportPreviewPanel';
import { buildExportText } from './buildExportText';
import { noExportMessage } from './exportFilter';

export async function exportForLLM(store: AnnotationStore): Promise<void> {
  const output = await buildExportText(store);

  if (output === null) {
    // Distinguish "no annotations" from "everything is resolved".
    const total = (await store.load()).annotations.length;
    vscode.window.showWarningMessage(noExportMessage(total));
    return;
  }

  ExportPreviewPanel.show(output);
}
