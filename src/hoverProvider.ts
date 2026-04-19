import * as vscode from 'vscode';
import { Annotation } from './types';
import { AnnotationStore } from './annotationStore';
import { parseMentions } from './mentions';

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function commandLink(label: string, command: string, annotation: Annotation): string {
  const args = encodeURIComponent(JSON.stringify([{ id: annotation.id }]));
  return `[${label}](command:${command}?${args})`;
}

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
    md.isTrusted = true; // required for command URIs in Edit/Delete links
    md.supportThemeIcons = true;

    matching.forEach((ann, i) => {
      if (i > 0) {
        md.appendMarkdown('\n\n---\n\n');
      }

      // Header: icon + label + timestamp
      const wasEdited = ann.updatedAt !== ann.createdAt;
      const timestampLabel = wasEdited
        ? `edited ${formatTimestamp(ann.updatedAt)}`
        : `created ${formatTimestamp(ann.createdAt)}`;
      md.appendMarkdown(`$(comment) **Annotation** &nbsp;*${timestampLabel}*\n\n`);

      // Body: user-supplied comment — appendText escapes Markdown, preventing injection
      md.appendText(ann.comment);

      // @mention badges — parsed from the comment, shown as inline code tokens
      const mentions = parseMentions(ann.comment);
      if (mentions.length > 0) {
        md.appendMarkdown('\n\n' + mentions.map(m => `\`${m}\``).join(' '));
      }

      // Action buttons
      const editLink   = commandLink('$(pencil) Edit',   'annotate.editAnnotation',   ann);
      const deleteLink = commandLink('$(trash) Delete', 'annotate.deleteAnnotation', ann);
      const diffLink   = ann.contentSnapshot
        ? ' &nbsp; ' + commandLink('$(diff) Diff', 'annotate.showStaleDiff', ann)
        : '';
      md.appendMarkdown(`\n\n${editLink} &nbsp; ${deleteLink}${diffLink}`);
    });

    return new vscode.Hover([md], hoverRange);
  }
}
