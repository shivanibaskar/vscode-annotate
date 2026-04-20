import * as vscode from 'vscode';
import { AnnotationStore } from './annotationStore';
import { Annotation, AnnotationTag } from './types';

const TAG_ICONS: Record<AnnotationTag, string> = {
  bug:       '$(bug)',
  context:   '$(info)',
  question:  '$(question)',
  todo:      '$(check)',
  important: '$(star)',
};

const MAX_PREVIEW_LEN = 48;

/**
 * Provides inline CodeLens actions above each annotated line range.
 * Shows a truncated comment preview alongside Edit and Delete actions,
 * so the user can act on an annotation from near the code itself rather
 * than hunting for it in the sidebar.
 */
export class AnnotationCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  /** Fires when the store changes so VS Code re-queries lenses. */
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  constructor(private readonly store: AnnotationStore) {
    store.onDidChange(() => this._onDidChangeCodeLenses.fire());
  }

  /**
   * @param document The document being rendered.
   * @returns Three CodeLens items (preview, pencil, trash) for a single annotation,
   *   or one summary lens when multiple annotations share the same start line.
   */
  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (document.lineCount === 0) {
      return [];
    }

    const relPath = vscode.workspace.asRelativePath(document.uri, false);
    const annotations = await this.store.getForFile(relPath);
    const lenses: vscode.CodeLens[] = [];

    // Group by clamped anchor line so multiple annotations on the same line
    // collapse into a summary rather than overflowing the CodeLens bar.
    const byLine = new Map<number, Annotation[]>();
    for (const annotation of annotations) {
      const lineNum = Math.max(0, annotation.range.start);
      // Clamp to document bounds — ranges can drift during rapid edits.
      const safeLine = Math.min(lineNum, document.lineCount - 1);
      const group = byLine.get(safeLine);
      if (group) {
        group.push(annotation);
      } else {
        byLine.set(safeLine, [annotation]);
      }
    }

    for (const [safeLine, group] of byLine) {
      if (group.length === 0) { continue; } // invariant: should never happen, but guard defensively
      const range = new vscode.Range(safeLine, 0, safeLine, 0);
      if (group.length === 1) {
        lenses.push(
          previewLens(range, group[0]),
          editLens(range, group[0]),
          deleteLens(range, group[0]),
        );
      } else {
        lenses.push(summaryLens(range, group));
      }
    }

    return lenses;
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function summaryLens(range: vscode.Range, annotations: Annotation[]): vscode.CodeLens {
  return new vscode.CodeLens(range, {
    title: `$(comment)  ${annotations.length} annotations on this line`,
    command: 'annotate.revealAnnotation',
    arguments: [annotations[0]],
    tooltip: annotations.map(a => a.comment).join('\n---\n'),
  });
}

function previewLens(range: vscode.Range, annotation: Annotation): vscode.CodeLens {
  const icon = annotation.tag ? TAG_ICONS[annotation.tag] : '$(comment)';
  const preview = annotation.comment.length > MAX_PREVIEW_LEN
    ? `${annotation.comment.slice(0, MAX_PREVIEW_LEN)}…`
    : annotation.comment;
  return new vscode.CodeLens(range, {
    title: `${icon}  ${preview}`,
    command: 'annotate.revealAnnotation',
    arguments: [annotation],
    tooltip: annotation.comment,
  });
}

function editLens(range: vscode.Range, annotation: Annotation): vscode.CodeLens {
  return new vscode.CodeLens(range, {
    title: '$(pencil)',
    command: 'annotate.editAnnotation',
    arguments: [annotation],
  });
}

function deleteLens(range: vscode.Range, annotation: Annotation): vscode.CodeLens {
  return new vscode.CodeLens(range, {
    title: '$(trash)',
    command: 'annotate.deleteAnnotation',
    arguments: [annotation],
  });
}
