import * as vscode from 'vscode';
import { AnnotationStore } from './annotationStore';

export class DecorationsManager {
  private readonly decorationType: vscode.TextEditorDecorationType;

  constructor(private readonly store: AnnotationStore) {
    this.decorationType = vscode.window.createTextEditorDecorationType({
      isWholeLine: true,
      backgroundColor: new vscode.ThemeColor('editor.wordHighlightBackground'),
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('editorInfo.foreground'),
      overviewRulerColor: new vscode.ThemeColor('editorInfo.foreground'),
      overviewRulerLane: vscode.OverviewRulerLane.Left,
    });
  }

  async refresh(editor: vscode.TextEditor): Promise<void> {
    const relPath = vscode.workspace.asRelativePath(editor.document.uri, false);
    const annotations = await this.store.getForFile(relPath);

    const ranges = annotations.map(a =>
      new vscode.Range(
        new vscode.Position(a.range.start, 0),
        new vscode.Position(a.range.end, Number.MAX_SAFE_INTEGER)
      )
    );

    editor.setDecorations(this.decorationType, ranges);
  }

  clearAll(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      editor.setDecorations(this.decorationType, []);
    }
  }

  dispose(): void {
    this.decorationType.dispose();
  }
}
