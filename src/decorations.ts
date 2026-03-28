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

const ALL_TAGS: (AnnotationTag | '_default')[] = [
  'bug', 'question', 'todo', 'context', 'important', '_default',
];

/** Amber border used for annotations whose source lines have changed since creation. */
const STALE_DECORATION = vscode.window.createTextEditorDecorationType({
  backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
  borderWidth: '0 0 0 3px',
  borderStyle: 'dashed',
  borderColor: new vscode.ThemeColor('editorWarning.foreground'),
  overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
  overviewRulerLane: vscode.OverviewRulerLane.Left,
});

function makeDecorationType(colorToken: string): vscode.TextEditorDecorationType {
  return vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
    borderWidth: '0 0 0 3px',
    borderStyle: 'solid',
    borderColor: new vscode.ThemeColor(colorToken),
    overviewRulerColor: new vscode.ThemeColor(colorToken),
    overviewRulerLane: vscode.OverviewRulerLane.Left,
  });
}

export class DecorationsManager {
  private readonly types: Map<AnnotationTag | '_default', vscode.TextEditorDecorationType>;

  constructor(private readonly store: AnnotationStore) {
    this.types = new Map(
      ALL_TAGS.map(tag => [tag, makeDecorationType(TAG_COLORS[tag])])
    );
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
    editor.setDecorations(STALE_DECORATION, staleRanges);
  }

  clearAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      for (const type of this.types.values()) {
        editor.setDecorations(type, []);
      }
      editor.setDecorations(STALE_DECORATION, []);
    }
  }

  dispose(): void {
    for (const type of this.types.values()) {
      type.dispose();
    }
    STALE_DECORATION.dispose();
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
