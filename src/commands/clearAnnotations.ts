import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { DecorationsManager } from '../decorations';

export async function clearAnnotations(
  store: AnnotationStore,
  decorations: DecorationsManager
): Promise<void> {
  const choice = await vscode.window.showWarningMessage(
    'Clear all annotations for this workspace?',
    { modal: true },
    'Clear'
  );

  if (choice !== 'Clear') {
    return;
  }

  await store.clear();
  decorations.clearAll();
  vscode.window.showInformationMessage('All annotations cleared.');
}
