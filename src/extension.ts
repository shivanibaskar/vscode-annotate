import * as vscode from 'vscode';
import { AnnotationStore } from './annotationStore';
import { DecorationsManager } from './decorations';
import { AnnotationHoverProvider } from './hoverProvider';
import { AnnotationsTreeProvider, AnnotationNode, SortMode } from './annotationsTreeProvider';
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
import { registerTerminalCloseListener } from './commands/exportToTerminal';
import { copyFileAnnotations } from './commands/copyFileAnnotations';
import { copyToClipboard } from './commands/copyToClipboard';

export function activate(context: vscode.ExtensionContext): void {
  const store = new AnnotationStore();
  const decorations = new DecorationsManager(store, context.extensionUri);
  const branchWatcher = new GitBranchWatcher();
  context.subscriptions.push(branchWatcher);
  const treeProvider = new AnnotationsTreeProvider(store);
  const treeView = vscode.window.createTreeView('annotate.annotationsView', {
    treeDataProvider: treeProvider,
    showCollapseAll: true,
  });

  // ── Status bar ────────────────────────────────────────────────────────────
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'workbench.view.extension.annotate-sidebar';
  statusBar.tooltip = 'Open LLM Annotator panel';
  context.subscriptions.push(statusBar);

  async function updateStatusBar(): Promise<void> {
    const data = await store.load();
    const count = data.annotations.length;
    if (count === 0) {
      statusBar.hide();
    } else {
      statusBar.text = count === 1 ? '$(comment) 1 annotation' : `$(comment) ${count} annotations`;
      statusBar.show();
    }
  }

  // ── Sidebar title / empty-state message ───────────────────────────────────
  // Kept synchronous to remain compatible with syncWithBranch's callback type;
  // async work runs in a fire-and-forget IIFE with error logging.
  function updateTreeViewTitle(): void {
    void (async () => {
      try {
        const data = await store.load();
        if (data.annotations.length === 0) {
          treeView.message = `No annotations yet — select text and press ${
            process.platform === 'darwin' ? '⌘' : 'Ctrl'
          }+Shift+H to start`;
        } else {
          treeView.message = store.setName === 'default' ? undefined : `Set: ${store.setName}`;
        }
      } catch (err) {
        console.error('[annotate] Failed to update tree view title:', err);
      }
    })();
  }

  registerTerminalCloseListener(context);
  updateTreeViewTitle();
  void updateStatusBar();

  /**
   * Refreshes the built-in Markdown preview if one is currently open, so the
   * annotation overlay script re-runs and picks up the latest annotation data.
   * Fails silently — the command may not be available on remote targets.
   */
  async function refreshMarkdownPreviewIfOpen(): Promise<void> {
    const hasPreview = vscode.window.tabGroups.all.some(group =>
      group.tabs.some(
        tab =>
          tab.input instanceof vscode.TabInputWebview &&
          tab.input.viewType === 'markdown.preview'
      )
    );
    if (!hasPreview) { return; }
    try {
      await vscode.commands.executeCommand('markdown.preview.refresh');
    } catch {
      // markdown.preview.refresh may not exist on server-side remotes without
      // the built-in Markdown extension — ignore and carry on.
    }
  }

  context.subscriptions.push(
    store.onDidChange(() => {
      updateTreeViewTitle();
      void updateStatusBar();
      void refreshMarkdownPreviewIfOpen();
    })
  );

  context.subscriptions.push(treeView, { dispose: () => treeProvider.dispose() });
  context.subscriptions.push({ dispose: () => store.dispose() });

  // ── First-install welcome notification ────────────────────────────────────
  if (!context.globalState.get<boolean>('annotate.welcomed')) {
    void context.globalState.update('annotate.welcomed', true);
    vscode.window.showInformationMessage(
      'LLM Annotator ready! ' +
      `${process.platform === 'darwin' ? '⌘' : 'Ctrl'}+Shift+H to annotate, ` +
      `${process.platform === 'darwin' ? '⌘' : 'Ctrl'}+Shift+X to export, ` +
      `${process.platform === 'darwin' ? '⌘' : 'Ctrl'}+Shift+F to search.`,
      'Got it'
    );
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('annotate.annotateSelection',
      () => annotateSelection(store, decorations)),

    vscode.commands.registerCommand('annotate.exportForLLM',
      () => exportForLLM(store)),

    vscode.commands.registerCommand('annotate.clearAnnotations',
      () => clearAnnotations(store, decorations, vscode.window.activeTextEditor)),

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

    vscode.commands.registerCommand('annotate.copyFileAnnotations',
      () => copyFileAnnotations(store)),

    vscode.commands.registerCommand('annotate.copyToClipboard',
      () => copyToClipboard(store)),

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

    // ── Sort mode command ────────────────────────────────────────────────────
    vscode.commands.registerCommand('annotate.setSortMode', async () => {
      const current = treeProvider.sortMode;
      const picks: Array<{ label: string; mode: SortMode; description?: string }> = [
        { label: '$(file) Sort by file',  mode: 'file', description: current === 'file' ? '(current)' : undefined },
        { label: '$(calendar) Sort by date', mode: 'date', description: current === 'date' ? '(current)' : undefined },
        { label: '$(tag) Sort by tag',    mode: 'tag',  description: current === 'tag'  ? '(current)' : undefined },
      ];
      const picked = await vscode.window.showQuickPick(picks, { placeHolder: 'Select annotation sort order' });
      if (!picked) { return; }
      treeProvider.setSortMode(picked.mode);
      await vscode.workspace.getConfiguration('annotate').update(
        'sidebarSortMode',
        picked.mode,
        vscode.ConfigurationTarget.Workspace
      );
    }),

    // Sync sort mode when settings.json is edited directly.
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('annotate.sidebarSortMode')) {
        const raw = vscode.workspace.getConfiguration('annotate').get<string>('sidebarSortMode');
        const mode: SortMode = raw === 'date' || raw === 'tag' ? raw : 'file';
        treeProvider.setSortMode(mode);
      }
    }),

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
