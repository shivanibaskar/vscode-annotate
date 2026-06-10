import * as path from 'path';
import * as vscode from 'vscode';
import { Annotation } from './types';
import { AnnotationStore } from './annotationStore';
import { parseMentions } from './mentions';

const MAX_LABEL_LEN = 60;

/** Sort modes for the annotations sidebar panel. */
export type SortMode = 'file' | 'date' | 'tag';

/** Tag priority for sort-by-tag mode. Lower number = higher priority. */
const TAG_PRIORITY: Record<string, number> = {
  bug:       0,
  important: 1,
  question:  2,
  todo:      3,
  context:   4,
};

function truncate(str: string): string {
  return str.length > MAX_LABEL_LEN ? str.slice(0, MAX_LABEL_LEN) + '…' : str;
}

function lineLabel(start: number, end: number): string {
  // Convert 0-based stored lines to 1-based display lines.
  const s = start + 1;
  const e = end + 1;
  return s === e ? `Line ${s}` : `Lines ${s}–${e}`;
}

export class FileNode extends vscode.TreeItem {
  readonly fileUri: string;

  /**
   * @param fileUri       - Workspace-relative path of the file.
   * @param count         - Number of annotations shown under this node.
   * @param resolvedCount - How many of those are resolved (0 keeps the legacy label).
   */
  constructor(fileUri: string, count: number, resolvedCount = 0) {
    super(
      path.basename(fileUri),
      vscode.TreeItemCollapsibleState.Expanded
    );
    this.fileUri = fileUri;
    const base = count === 1 ? '1 annotation' : `${count} annotations`;
    this.description = resolvedCount > 0 ? `${base} (${resolvedCount} resolved)` : base;
    this.contextValue = 'fileNode';
    this.iconPath = vscode.ThemeIcon.File;
  }
}

const TAG_ICONS: Record<string, string> = {
  bug:       'bug',
  context:   'info',
  question:  'question',
  todo:      'check',
  important: 'star',
};

export class AnnotationNode extends vscode.TreeItem {
  readonly annotation: Annotation;

  constructor(annotation: Annotation) {
    super(truncate(annotation.comment), vscode.TreeItemCollapsibleState.None);
    this.annotation = annotation;
    const tagLabel = annotation.tag ? ` [${annotation.tag}]` : '';
    const mentions = parseMentions(annotation.comment);
    const mentionLabel = mentions.length > 0 ? '  ' + mentions.join(' ') : '';
    const resolvedLabel = annotation.resolved ? ' · ✓ resolved' : '';
    this.description = lineLabel(annotation.range.start, annotation.range.end) + tagLabel + mentionLabel + resolvedLabel;
    this.tooltip = annotation.resolved ? `✓ Resolved\n\n${annotation.comment}` : annotation.comment;
    const iconId = annotation.resolved
      ? 'pass-filled'
      : annotation.tag ? (TAG_ICONS[annotation.tag] ?? 'comment') : 'comment';
    this.iconPath = new vscode.ThemeIcon(iconId);
    this.contextValue = 'annotationNode';
    this.command = {
      command: 'annotate.revealAnnotation',
      title: 'Go to Annotation',
      arguments: [annotation],
    };
  }
}

export class AnnotationsTreeProvider
  implements vscode.TreeDataProvider<FileNode | AnnotationNode> {

  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<FileNode | AnnotationNode | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _sortMode: SortMode = 'file';
  private _showResolved = true;

  constructor(private readonly store: AnnotationStore) {
    store.onDidChange(() => this._onDidChangeTreeData.fire());

    // Initialise sort mode and resolved-visibility from workspace config.
    const config = vscode.workspace.getConfiguration('annotate');
    this._sortMode = toSortMode(config.get<string>('sidebarSortMode'));
    this._showResolved = config.get<boolean>('sidebarShowResolved', true);
    // Drive the eye / eye-closed toolbar button via a context key.
    void vscode.commands.executeCommand('setContext', 'annotate.showResolved', this._showResolved);
  }

  getTreeItem(element: FileNode | AnnotationNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FileNode | AnnotationNode): Promise<(FileNode | AnnotationNode)[]> {
    if (element instanceof AnnotationNode) {
      return [];
    }

    const data = await this.store.load();
    const visible = this._showResolved
      ? data.annotations
      : data.annotations.filter(a => !a.resolved);

    if (!element) {
      // Root: group annotations by file, then sort according to current mode.
      const byFile = new Map<string, Annotation[]>();
      for (const ann of visible) {
        const list = byFile.get(ann.fileUri) ?? [];
        list.push(ann);
        byFile.set(ann.fileUri, list);
      }

      let entries = [...byFile.entries()];

      if (this._sortMode === 'date') {
        // Sort files by most-recent annotation updatedAt, newest first.
        entries.sort(([, annsA], [, annsB]) => {
          const maxA = Math.max(...annsA.map(a => new Date(a.updatedAt).getTime()));
          const maxB = Math.max(...annsB.map(a => new Date(a.updatedAt).getTime()));
          return maxB - maxA;
        });
      } else {
        // 'file' or 'tag': sort files alphabetically.
        entries.sort(([a], [b]) => a.localeCompare(b));
      }

      return entries.map(([fileUri, anns]) =>
        new FileNode(fileUri, anns.length, anns.filter(a => a.resolved).length)
      );
    }

    // FileNode: return AnnotationNodes for this file, sorted per current mode.
    const annotations = visible.filter(a => a.fileUri === element.fileUri);

    if (this._sortMode === 'date') {
      // Newest annotation first.
      annotations.sort((a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
    } else if (this._sortMode === 'tag') {
      // Sort by tag priority (undefined = last), then by start line.
      annotations.sort((a, b) => {
        const pa = a.tag !== undefined ? (TAG_PRIORITY[a.tag] ?? 5) : 6;
        const pb = b.tag !== undefined ? (TAG_PRIORITY[b.tag] ?? 5) : 6;
        return pa !== pb ? pa - pb : a.range.start - b.range.start;
      });
    } else {
      annotations.sort((a, b) => a.range.start - b.range.start);
    }

    return annotations.map(a => new AnnotationNode(a));
  }

  /**
   * Change the sort mode and immediately refresh the tree.
   *
   * When `persist` is `true` (the default), the choice is written to the
   * `annotate.sidebarSortMode` workspace setting. Pass `persist: false` when
   * calling from an `onDidChangeConfiguration` handler to avoid a write-back
   * loop (the config has already been updated externally in that case).
   *
   * @param mode    - The new sort mode.
   * @param persist - Whether to persist the value to workspace config (default `true`).
   */
  setSortMode(mode: SortMode, persist = true): void {
    this._sortMode = mode;
    this._onDidChangeTreeData.fire();
    if (persist) {
      void vscode.workspace.getConfiguration('annotate').update(
        'sidebarSortMode',
        mode,
        vscode.ConfigurationTarget.Workspace
      );
    }
  }

  /** Returns the currently active sort mode. */
  get sortMode(): SortMode {
    return this._sortMode;
  }

  /**
   * Show or hide resolved annotations in the tree and refresh it.
   *
   * Mirrors {@link setSortMode}: pass `persist: false` from the
   * `onDidChangeConfiguration` handler to avoid a write-back loop.
   *
   * @param show    - Whether resolved annotations should be visible.
   * @param persist - Whether to persist to the `annotate.sidebarShowResolved` workspace setting.
   */
  setShowResolved(show: boolean, persist = true): void {
    this._showResolved = show;
    void vscode.commands.executeCommand('setContext', 'annotate.showResolved', show);
    this._onDidChangeTreeData.fire();
    if (persist) {
      void vscode.workspace.getConfiguration('annotate').update(
        'sidebarShowResolved',
        show,
        vscode.ConfigurationTarget.Workspace
      );
    }
  }

  /** Whether resolved annotations are currently visible in the tree. */
  get showResolved(): boolean {
    return this._showResolved;
  }

  forceRefresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}

/** Coerce an unknown config value to a valid SortMode, defaulting to 'file'. */
function toSortMode(value: string | undefined): SortMode {
  if (value === 'date' || value === 'tag') { return value; }
  return 'file';
}
