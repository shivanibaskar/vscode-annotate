import * as vscode from 'vscode';
import { AnnotationStore } from './annotationStore';
import { DecorationsManager } from './decorations';
import { AnnotationHoverProvider } from './hoverProvider';
import { annotateSelection } from './commands/annotateSelection';
import { exportForLLM } from './commands/exportForLLM';
import { clearAnnotations } from './commands/clearAnnotations';

export function activate(context: vscode.ExtensionContext): void {
  const store = new AnnotationStore();
  const decorations = new DecorationsManager(store);

  context.subscriptions.push(
    vscode.commands.registerCommand('annotate.annotateSelection',
      () => annotateSelection(store, decorations)),

    vscode.commands.registerCommand('annotate.exportForLLM',
      () => exportForLLM(store)),

    vscode.commands.registerCommand('annotate.clearAnnotations',
      () => clearAnnotations(store, decorations)),

    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) { decorations.refresh(editor); }
    }),

    // Keep annotation ranges in sync as the user edits files.
    vscode.workspace.onDidChangeTextDocument(async event => {
      const relPath = vscode.workspace.asRelativePath(event.document.uri, false);
      await store.shiftAnnotations(relPath, event.contentChanges);
      const editor = vscode.window.visibleTextEditors.find(
        e => e.document === event.document
      );
      if (editor) {
        await decorations.refresh(editor);
      }
    }),

    vscode.languages.registerHoverProvider('*', new AnnotationHoverProvider(store)),

    { dispose: () => decorations.dispose() },
  );

  for (const editor of vscode.window.visibleTextEditors) {
    decorations.refresh(editor);
  }
}

export function deactivate(): void {}
