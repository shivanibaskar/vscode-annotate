import * as vscode from 'vscode';
import { AnnotationStore } from './annotationStore';
import { DecorationsManager } from './decorations';
import { AnnotationHoverProvider } from './hoverProvider';
import { AnnotationsTreeProvider, AnnotationNode, SortMode } from './annotationsTreeProvider';
import { Annotation, HoverArg } from './types';
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
import { toggleResolved } from './commands/toggleResolved';
import { annotationToRange } from './rangeUtils';
import { resolveFileUri, toFileUri } from './workspaceUtils';

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
    const total = data.annotations.length;
    const resolvedCount = data.annotations.filter(a => a.resolved).length;
    const open = total - resolvedCount;
    if (total === 0) {
      statusBar.hide();
      return;
    }
    if (open === 0) {
      // Everything addressed — celebrate rather than show "0 annotations".
      statusBar.text = `$(comment) ${resolvedCount} resolved`;
    } else {
      statusBar.text = open === 1 ? '$(comment) 1 annotation' : `$(comment) ${open} annotations`;
      if (resolvedCount > 0) {
        statusBar.text += ` · ${resolvedCount} resolved`;
      }
    }
    statusBar.show();
  }

  // ── Sidebar title / empty-state message ───────────────────────────────────
  // Kept synchronous to remain compatible with syncWithBranch's callback type;
  // async work runs in a fire-and-forget IIFE with error logging.
  function updateTreeViewTitle(): void {
    void (async () => {
      try {
        const data = await store.load();
        const total = data.annotations.length;
        const resolvedCount = data.annotations.filter(a => a.resolved).length;
        if (total === 0) {
          treeView.message = `No annotations yet — select text and press ${
            process.platform === 'darwin' ? '⌘' : 'Ctrl'
          }+Shift+H to start`;
        } else if (!treeProvider.showResolved && resolvedCount === total) {
          // The tree would render empty with no hint otherwise.
          treeView.message = `${resolvedCount} resolved annotation${resolvedCount === 1 ? '' : 's'} hidden — use the eye icon to show.`;
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
  // Correct a stale active-set pointer left by a previous session (the store
  // always boots on the default set). Does not create the file if absent.
  store.syncActiveSetPointer();

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
    // Make sure pending annotation/pointer writes have landed on disk before
    // the preview script re-fetches them, or it would render stale data.
    await store.flush();
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
    const mod = process.platform === 'darwin' ? '⌘' : 'Ctrl';
    vscode.window.showInformationMessage(
      'LLM Annotator ready! ' +
      `${mod}+Shift+H to annotate, ` +
      `${mod}+Shift+A then X to export, ` +
      `${mod}+Shift+A then F to search.`,
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
      (nodeOrAnnotation?: AnnotationNode | Annotation | HoverArg) =>
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
    }),

    // Sync sidebar preferences when settings.json is edited directly.
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('annotate.sidebarSortMode')) {
        const raw = vscode.workspace.getConfiguration('annotate').get<string>('sidebarSortMode');
        const mode: SortMode = raw === 'date' || raw === 'tag' ? raw : 'file';
        treeProvider.setSortMode(mode, false);
      }
      if (e.affectsConfiguration('annotate.sidebarShowResolved')) {
        const show = vscode.workspace.getConfiguration('annotate').get<boolean>('sidebarShowResolved', true);
        treeProvider.setShowResolved(show, false);
        updateTreeViewTitle();
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
      const relPath = toFileUri(event.document.uri);
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
      (nodeOrAnnotation?: AnnotationNode | Annotation | HoverArg) => editAnnotation(store, decorations, nodeOrAnnotation)
    ),

    vscode.commands.registerCommand(
      'annotate.deleteAnnotation',
      (nodeOrAnnotation?: AnnotationNode | Annotation | HoverArg) => deleteAnnotation(store, decorations, nodeOrAnnotation)
    ),

    vscode.commands.registerCommand(
      'annotate.toggleResolved',
      (nodeOrAnnotation?: AnnotationNode | Annotation | HoverArg) => toggleResolved(store, decorations, nodeOrAnnotation)
    ),

    // Eye / eye-closed pair in the sidebar toolbar — which one is visible is
    // driven by the annotate.showResolved context key set by the provider.
    vscode.commands.registerCommand('annotate.hideResolved', () => {
      treeProvider.setShowResolved(false);
      updateTreeViewTitle();
    }),
    vscode.commands.registerCommand('annotate.showResolved', () => {
      treeProvider.setShowResolved(true);
      updateTreeViewTitle();
    }),

    vscode.commands.registerCommand('annotate.refreshAnnotationsView', () => {
      treeProvider.forceRefresh();
    }),

    vscode.commands.registerCommand(
      'annotate.revealAnnotation',
      async (annotation: Annotation) => {
        const uri = resolveFileUri(annotation.fileUri);
        if (!uri) { return; }
        const doc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(doc);
        // Character-precise so the selection matches exactly what was annotated.
        const range = annotationToRange(annotation);
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
