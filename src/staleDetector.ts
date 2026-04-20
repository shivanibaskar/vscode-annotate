import { Annotation } from './types';

/**
 * Returns `true` if the annotation has a content snapshot AND the current
 * text of those lines differs from the snapshot captured at creation time.
 *
 * Annotations without a snapshot (created before P4.4) are never considered
 * stale to avoid false positives on older data.
 *
 * @param annotation   - The annotation to check.
 * @param documentText - Full text of the annotated document.
 */
export function isAnnotationStale(annotation: Annotation, documentText: string): boolean {
  if (!annotation.contentSnapshot) {
    return false;
  }

  const lines = documentText.split('\n');
  // Guard: if the annotation's start line is beyond the file, the entire range is
  // gone and the annotation is definitely stale. Checking only the end would mark
  // partially-valid annotations stale (e.g. a 3-line annotation where only the
  // last line was trimmed away).
  if (annotation.range.start >= lines.length) {
    return true;
  }

  const currentContent = lines
    .slice(annotation.range.start, annotation.range.end + 1)
    .join('\n');

  // Trim trailing whitespace differences introduced by editors to reduce noise.
  return currentContent.trimEnd() !== annotation.contentSnapshot.trimEnd();
}
