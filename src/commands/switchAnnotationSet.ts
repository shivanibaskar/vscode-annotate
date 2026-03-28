import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { DecorationsManager } from '../decorations';

const NEW_SET_LABEL = '$(add) New set…';

export async function switchAnnotationSet(
  store: AnnotationStore,
  decorations: DecorationsManager,
  onSetChanged: (setName: string) => void
): Promise<void> {
  const existingSets = await AnnotationStore.listSets();
  const items = [
    ...existingSets.map(name => ({
      label: name === store.setName ? `$(check) ${name}` : name,
      name,
    })),
    { label: NEW_SET_LABEL, name: '' },
  ];

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: `Active set: "${store.setName}". Pick a set or create a new one.`,
    ignoreFocusOut: true,
  });
  if (!pick) { return; }

  let targetName: string;

  if (pick.label === NEW_SET_LABEL) {
    const input = await vscode.window.showInputBox({
      prompt: 'New annotation set name (alphanumeric, hyphens allowed)',
      placeHolder: 'auth-refactor',
      ignoreFocusOut: true,
      validateInput: v => {
        if (!v.trim()) { return 'Name cannot be empty.'; }
        if (!/^[a-zA-Z0-9-]+$/.test(v.trim())) {
          return 'Use only letters, numbers, and hyphens.';
        }
        return undefined;
      },
    });
    if (!input) { return; }
    targetName = input.trim();
  } else {
    targetName = pick.name;
  }

  if (targetName === store.setName) { return; }

  store.switchSet(targetName);
  onSetChanged(targetName);

  // Refresh decorations in all visible editors.
  for (const editor of vscode.window.visibleTextEditors) {
    await decorations.refresh(editor);
  }

  vscode.window.showInformationMessage(`Annotate: switched to set "${targetName}".`);
}
