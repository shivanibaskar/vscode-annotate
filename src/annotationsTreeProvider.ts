import * as path from 'path';
import * as vscode from 'vscode';
import { Annotation } from './types';
import { AnnotationStore } from './annotationStore';

const MAX_LABEL_LEN = 60;

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

  constructor(fileUri: string, count: number) {
    super(
      path.basename(fileUri),
      vscode.TreeItemCollapsibleState.Expanded
    );
    this.fileUri = fileUri;
    this.description = count === 1 ? '1 annotation' : `${count} annotations`;
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
    this.description = lineLabel(annotation.range.start, annotation.range.end) + tagLabel;
    this.tooltip = annotation.comment;
    const iconId = annotation.tag ? (TAG_ICONS[annotation.tag] ?? 'comment') : 'comment';
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

  constructor(private readonly store: AnnotationStore) {
    store.onDidChange(() => this._onDidChangeTreeData.fire());
  }

  getTreeItem(element: FileNode | AnnotationNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: FileNode | AnnotationNode): Promise<(FileNode | AnnotationNode)[]> {
    if (element instanceof AnnotationNode) {
      return [];
    }

    const data = await this.store.load();

    if (!element) {
      // Root: build one FileNode per distinct file, sorted alphabetically.
      const byFile = new Map<string, number>();
      for (const ann of data.annotations) {
        byFile.set(ann.fileUri, (byFile.get(ann.fileUri) ?? 0) + 1);
      }
      return [...byFile.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([fileUri, count]) => new FileNode(fileUri, count));
    }

    // FileNode: return AnnotationNodes for this file, sorted by start line.
    return data.annotations
      .filter(a => a.fileUri === element.fileUri)
      .sort((a, b) => a.range.start - b.range.start)
      .map(a => new AnnotationNode(a));
  }

  forceRefresh(): void {
    this._onDidChangeTreeData.fire();
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }
}
