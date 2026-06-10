import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { collectAllMentions, commentHasMention } from '../mentions';
import { exportForLLM } from './exportForLLM';
import { exportableAnnotations, noExportMessage } from './exportFilter';

/**
 * Prompts the user to pick one or more @mention tags, then exports only
 * annotations whose comment contains at least one of the selected mentions.
 *
 * Falls back to a full export if no @mentions exist in any annotation.
 *
 * @param store - The active annotation store.
 */
export async function exportFiltered(store: AnnotationStore): Promise<void> {
  const data = await store.load();
  // Collect mentions only from exportable annotations — a mention that exists
  // solely in resolved annotations would otherwise lead to a dead-end export.
  const exportable = exportableAnnotations(data.annotations);

  if (exportable.length === 0) {
    vscode.window.showWarningMessage(noExportMessage(data.annotations.length));
    return;
  }

  const allMentions = collectAllMentions(exportable.map(a => a.comment));

  if (allMentions.length === 0) {
    vscode.window.showInformationMessage(
      'Annotate: No @mentions found. Exporting all annotations.'
    );
    await exportForLLM(store);
    return;
  }

  const picked = await vscode.window.showQuickPick(
    allMentions.map(m => ({ label: m })),
    {
      placeHolder: 'Select @mention tags to export (multi-select with space)…',
      canPickMany: true,
      ignoreFocusOut: true,
    }
  );

  // User cancelled the picker.
  if (!picked) { return; }

  if (picked.length === 0) {
    vscode.window.showWarningMessage('Annotate: No tags selected — export cancelled.');
    return;
  }

  const selectedMentions = new Set(picked.map(p => p.label));
  const filtered = exportable.filter(a =>
    commentHasMention(a.comment, selectedMentions)
  );

  if (filtered.length === 0) {
    vscode.window.showWarningMessage(
      `Annotate: No annotations match the selected tags (${[...selectedMentions].join(', ')}).`
    );
    return;
  }

  // Build a minimal store-like object that satisfies only the load() interface
  // used by exportForLLM. Object.create would create a prototype chain proxy
  // with inaccessible private members; a plain wrapper is safer and clearer.
  const filteredStore = {
    load: async () => ({ version: 1 as const, annotations: filtered }),
  } as unknown as AnnotationStore;

  await exportForLLM(filteredStore);
}
