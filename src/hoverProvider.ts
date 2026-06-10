import * as vscode from 'vscode';
import { Annotation } from './types';
import { AnnotationStore } from './annotationStore';
import { parseMentions } from './mentions';
import { annotationToRange } from './rangeUtils';

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

    // Match against the character-precise range so an annotation on part of
    // a line is not attributed to (or highlighted across) the whole line.
    // Legacy annotations without char info fall back to whole-line ranges.
    const matchingRanges = annotations
      .map(a => ({ annotation: a, range: annotationToRange(a) }))
      .filter(({ range }) => range.contains(position));

    if (matchingRanges.length === 0) {
      return undefined;
    }

    const matching = matchingRanges.map(({ annotation }) => annotation);
    // VS Code highlights the hover range while the popup is visible, so keep
    // it as tight as the matching annotations allow.
    const hoverRange = matchingRanges
      .map(({ range }) => range)
      .reduce((acc, r) => acc.union(r));

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
