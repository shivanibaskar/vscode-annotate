import * as vscode from 'vscode';
import { AnnotationStore } from './annotationStore';

export class AnnotationHoverProvider implements vscode.HoverProvider {
  constructor(private readonly store: AnnotationStore) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position
  ): Promise<vscode.Hover | undefined> {
    const relPath = vscode.workspace.asRelativePath(document.uri, false);
    const annotations = await this.store.getForFile(relPath);

    const matching = annotations.filter(
      a => position.line >= a.range.start && position.line <= a.range.end
    );

    if (matching.length === 0) {
      return undefined;
    }

    const startLine = Math.min(...matching.map(a => a.range.start));
    const endLine   = Math.max(...matching.map(a => a.range.end));
    const hoverRange = new vscode.Range(
      new vscode.Position(startLine, 0),
      new vscode.Position(endLine, Number.MAX_SAFE_INTEGER)
    );

    const md = new vscode.MarkdownString();
    md.isTrusted = false;
    md.supportThemeIcons = true;

    matching.forEach((ann, i) => {
      if (i > 0) {
        md.appendMarkdown('\n\n---\n\n');
      }
      md.appendMarkdown('$(comment) **Annotation**\n\n');
      md.appendText(ann.comment); // appendText escapes Markdown — safe for user-supplied content
    });

    return new vscode.Hover([md], hoverRange);
  }
}
