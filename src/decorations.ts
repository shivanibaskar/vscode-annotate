import * as vscode from 'vscode';
import { Annotation, AnnotationTag } from './types';
import { AnnotationStore } from './annotationStore';
import { isAnnotationStale } from './staleDetector';

const TAG_COLORS: Record<AnnotationTag | '_default', string> = {
  bug:       'errorForeground',
  question:  'notificationsWarningIcon.foreground',
  todo:      'notificationsInfoIcon.foreground',
  context:   'editorInfo.foreground',
  important: 'charts.purple',
  _default:  'editorInfo.foreground',
};

const GUTTER_ICONS: Record<AnnotationTag | '_default' | '_stale', string> = {
  bug:       'gutter-bug.svg',
  question:  'gutter-question.svg',
  todo:      'gutter-todo.svg',
  context:   'gutter-context.svg',
  important: 'gutter-important.svg',
  _default:  'gutter-default.svg',
  _stale:    'gutter-stale.svg',
};

const ALL_TAGS: (AnnotationTag | '_default')[] = [
  'bug', 'question', 'todo', 'context', 'important', '_default',
];

function makeDecorationType(
  colorToken: string,
  gutterIconPath?: vscode.Uri
): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
    borderWidth: '0 0 0 3px',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor(colorToken),
    overviewRulerColor: new vscode.ThemeColor(colorToken),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
    ...(gutterIconPath ? { gutterIconPath, gutterIconSize: 'contain' } : {}),
  });
}

export class DecorationsManager {
  private readonly types: Map<AnnotationTag | '_default', vscode.TextEditorDecorationType>;
  private readonly staleDecoration: vscode.TextEditorDecorationType;

  /**
   * @param store        - The active annotation store.
   * @param extensionUri - Optional URI of the extension root. When provided,
   *                       per-tag gutter icons are loaded from `media/`.
   */
  constructor(
    private readonly store: AnnotationStore,
    private readonly extensionUri?: vscode.Uri
  ) {
    this.types = new Map(
      ALL_TAGS.map(tag => {
        const iconPath = extensionUri
          ? vscode.Uri.joinPath(extensionUri, 'media', GUTTER_ICONS[tag])
          : undefined;
        return [tag, makeDecorationType(TAG_COLORS[tag], iconPath)];
      })
    );

    const staleIconPath = extensionUri
      ? vscode.Uri.joinPath(extensionUri, 'media', GUTTER_ICONS['_stale'])
      : undefined;
    this.staleDecoration = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
      borderWidth: '0 0 0 3px',
      borderStyle: 'dashed',
      borderColor: new vscode.ThemeColor('editorWarning.foreground'),
      overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
      ...(staleIconPath ? { gutterIconPath: staleIconPath, gutterIconSize: 'contain' } : {}),
    });

    // Validate icons at construction time so a packaging mistake (missing SVG)
    // surfaces a warning immediately rather than silently producing blank gutters.
    if (extensionUri) {
      void this._warnIfIconsMissing(extensionUri);
    }
  }

  private async _warnIfIconsMissing(extensionUri: vscode.Uri): Promise<void> {
    const allIcons = Object.values(GUTTER_ICONS);
    const missing: string[] = [];
    for (const icon of allIcons) {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(extensionUri, 'media', icon));
      } catch {
        missing.push(icon);
      }
    }
    if (missing.length > 0) {
      vscode.window.showWarningMessage(
        `Annotate: Missing gutter icon(s): ${missing.join(', ')}. Gutter decorations may not display correctly.`
      );
    }
  }

  async refresh(editor: vscode.TextEditor): Promise<void> {
    const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
    const annotations = await this.store.getForFile(relPath);
    const docText = editor.document.getText();

    // Group by tag key; stale annotations get their own amber decoration instead.
    const buckets = new Map<AnnotationTag | '_default', vscode.Range[]>();
    for (const tag of ALL_TAGS) { buckets.set(tag, []); }
    const staleRanges: vscode.Range[] = [];

    for (const a of annotations) {
      const range = annotationToRange(a);
      if (isAnnotationStale(a, docText)) {
        staleRanges.push(range);
      } else {
        const key: AnnotationTag | '_default' = a.tag ?? '_default';
        buckets.get(key)!.push(range);
      }
    }

    for (const tag of ALL_TAGS) {
      editor.setDecorations(this.types.get(tag)!, buckets.get(tag)!);
    }
    editor.setDecorations(this.staleDecoration, staleRanges);
  }

  /** Remove all decorations from all visible editors. */
  clearAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      for (const type of this.types.values()) {
        editor.setDecorations(type, []);
      }
      editor.setDecorations(this.staleDecoration, []);
    }
  }

  /** Re-apply decorations for all currently visible editors. Used after undo. */
  async refreshAll(): Promise<void> {
    for (const editor of vscode.window.visibleTextEditors) {
      await this.refresh(editor);
    }
  }

  dispose(): void {
    for (const type of this.types.values()) {
      type.dispose();
    }
    this.staleDecoration.dispose();
  }
}

function annotationToRange(a: Annotation): vscode.Range {
  const hasCharInfo =
    a.range.startChar !== undefined && a.range.endChar !== undefined;

  if (hasCharInfo) {
    return new vscode.Range(
      new vscode.Position(a.range.start, a.range.startChar!),
      new vscode.Position(a.range.end,   a.range.endChar!)
    );
  }

  // Legacy annotations without character info: highlight the full line span.
  return new vscode.Range(
    new vscode.Position(a.range.start, 0),
    new vscode.Position(a.range.end,   Number.MAX_SAFE_INTEGER)
  );
}
