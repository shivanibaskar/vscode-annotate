import * as vscode from 'vscode';
import { Annotation } from '../types';

/**
 * Returns the annotations that should appear in exports: resolved annotations
 * are excluded unless the `annotate.exportIncludeResolved` setting is enabled.
 *
 * @param annotations All annotations under consideration.
 * @returns The exportable subset (a new array when filtering occurs).
 */
export function exportableAnnotations(annotations: Annotation[]): Annotation[] {
  const includeResolved = vscode.workspace
    .getConfiguration('annotate')
    .get<boolean>('exportIncludeResolved', false);
  return includeResolved ? annotations : annotations.filter(a => !a.resolved);
}

/**
 * Builds the warning message for export commands that found nothing to export,
 * distinguishing "no annotations at all" from "everything is resolved" so the
 * user understands why a non-empty workspace produced an empty export.
 *
 * @param totalCount Total annotation count before resolved-filtering.
 * @returns A user-facing warning message.
 */
export function noExportMessage(totalCount: number): string {
  return totalCount > 0
    ? `Annotate: All ${totalCount} annotation${totalCount === 1 ? ' is' : 's are'} resolved — ` +
      'nothing to export. Enable annotate.exportIncludeResolved to export resolved annotations.'
    : 'Annotate: No annotations to export.';
}
