import * as vscode from 'vscode';
import { AnnotationStore } from './annotationStore';
import { DecorationsManager } from './decorations';
import { AnnotationHoverProvider } from './hoverProvider';
import { AnnotationsTreeProvider, AnnotationNode } from './annotationsTreeProvider';
import { Annotation } from './types';
import { annotateSelection } from './commands/annotateSelection';
import { exportForLLM } from './commands/exportForLLM';
import { clearAnnotations } from './commands/clearAnnotations';
import { editAnnotation } from './commands/editAnnotation';
import { deleteAnnotation } from './commands/deleteAnnotation';
import { exportMarkdown } from './commands/exportMarkdown';
import { switchAnnotationSet } from './commands/switchAnnotationSet';
import { exportCurrentFile } from './commands/exportCurrentFile';
import { searchAnnotations } from './commands/searchAnnotations';
import { exportFiltered } from './commands/exportFiltered';
import { exportToTerminal } from './commands/exportToTerminal';
import { GitBranchWatcher } from './gitBranchWatcher';
import { syncWithBranch } from './commands/syncWithBranch';
import { AnnotationSnapshotProvider, SNAPSHOT_SCHEME } from './annotationSnapshotProvider';
import { showStaleDiff } from './commands/showStaleDiff';
import { AnnotationCodeLensProvider } from './annotationCodeLensProvider';

export function activate(context: vscode.ExtensionContext): void {
  const store = new AnnotationStore();
  const decorations = new DecorationsManager(store);
  const branchWatcher = new GitBranchWatcher();
  context.subscriptions.push(branchWatcher);
  const treeProvider = new AnnotationsTreeProvider(store);
  const treeView = vscode.window.createTreeView('annotate.annotationsView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  function updateTreeViewTitle(): void {
    treeView.message = store.setName === 'default'
      ? undefined
      : `Set: ${store.setName}`;
  }
  updateTreeViewTitle();

  context.subscriptions.push(treeView, { dispose: () => treeProvider.dispose() });
  context.subscriptions.push({ dispose: () => store.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand('annotate.annotateSelection',
      () => annotateSelection(store, decorations)),

    vscode.commands.registerCommand('annotate.exportForLLM',
      () => exportForLLM(store)),

    vscode.commands.registerCommand('annotate.clearAnnotations',
      () => clearAnnotations(store, decorations)),

    vscode.commands.registerCommand('annotate.exportMarkdown',
      () => exportMarkdown(store)),

    vscode.commands.registerCommand('annotate.exportCurrentFile',
      () => exportCurrentFile(store)),

    vscode.commands.registerCommand('annotate.searchAnnotations',
      () => searchAnnotations(store)),

    vscode.commands.registerCommand('annotate.exportFiltered',
      () => exportFiltered(store)),

    vscode.commands.registerCommand('annotate.exportToTerminal',
      () => exportToTerminal(store)),

    vscode.commands.registerCommand('annotate.syncWithBranch',
      () => syncWithBranch(store, decorations, branchWatcher, updateTreeViewTitle)),

    vscode.commands.registerCommand(
      'annotate.showStaleDiff',
      (nodeOrAnnotation?: AnnotationNode | Annotation) =>
        showStaleDiff(store, nodeOrAnnotation)
    ),

    vscode.workspace.registerTextDocumentContentProvider(
      SNAPSHOT_SCHEME,
      new AnnotationSnapshotProvider(store)
    ),

    // Notify user when git HEAD changes so they can switch annotation sets.
    branchWatcher.onDidChangeBranch(async branch => {
      const setName = branch.replace(/[/\\:*?"<>|]/g, '-');
      const existing = await AnnotationStore.listSets();
      const hasSet = existing.includes(setName);
      const msg = hasSet
        ? `Git branch changed to "${branch}". This branch has its own annotations.`
        : `Git branch changed to "${branch}".`;
      const action = hasSet ? 'Switch Annotation Set' : undefined;
      const choice = action
        ? await vscode.window.showInformationMessage(msg, action)
        : undefined;
      if (choice === 'Switch Annotation Set') {
        await syncWithBranch(store, decorations, branchWatcher, updateTreeViewTitle);
      }
    }),

    vscode.commands.registerCommand('annotate.switchAnnotationSet',
      () => switchAnnotationSet(store, decorations, name => {
        updateTreeViewTitle();
      })),

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

    (() => {
      const provider = new AnnotationCodeLensProvider(store);
      context.subscriptions.push({ dispose: () => provider.dispose() });
      return vscode.languages.registerCodeLensProvider('*', provider);
    })(),

    vscode.commands.registerCommand(
      'annotate.editAnnotation',
      (nodeOrAnnotation?: AnnotationNode | Annotation) => editAnnotation(store, decorations, nodeOrAnnotation)
    ),

    vscode.commands.registerCommand(
      'annotate.deleteAnnotation',
      (nodeOrAnnotation?: AnnotationNode | Annotation) => deleteAnnotation(store, decorations, nodeOrAnnotation)
    ),

    vscode.commands.registerCommand('annotate.refreshAnnotationsView', () => {
      treeProvider.forceRefresh();
    }),

    vscode.commands.registerCommand(
      'annotate.revealAnnotation',
      async (annotation: Annotation) => {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders?.length) { return; }
        const uri = vscode.Uri.joinPath(folders[0].uri, annotation.fileUri);
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        const range = new vscode.Range(
          new vscode.Position(annotation.range.start, 0),
          new vscode.Position(annotation.range.end, Number.MAX_SAFE_INTEGER)
        );
        editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
        editor.selection = new vscode.Selection(range.start, range.end);
      }
    ),

    { dispose: () => decorations.dispose() },
  );

  for (const editor of vscode.window.visibleTextEditors) {
    decorations.refresh(editor);
  }
}

export function deactivate(): void {}
