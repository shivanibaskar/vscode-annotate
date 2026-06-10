import * as vscode from 'vscode';
import { Annotation } from './types';

/**
 * Returns `true` when the value is usable as a character offset.
 * The annotations JSON is hand-editable, so offsets read from disk may be
 * negative, fractional, NaN, or missing — `new vscode.Position()` throws on
 * some of those, so they must be screened out before constructing a Range.
 */
function isValidCharOffset(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0;
}

/**
 * Converts a stored annotation range to a `vscode.Range`.
 *
 * When the annotation carries valid character offsets (`startChar`/`endChar`)
 * the returned range is character-precise; otherwise it falls back to the
 * full line span so legacy annotations keep their original whole-line
 * behavior.
 *
 * Also repairs ranges persisted by a pre-0.1.4 bug where a selection ending
 * at column 0 of the following line stored `endChar: 0`, producing either a
 * reversed single-line range (which `vscode.Range` would silently swap onto
 * the unannotated prefix) or a multi-line range whose last line had zero
 * coverage. Both are extended to the end of their last line, matching what
 * the user originally selected.
 *
 * @param a The annotation whose range should be converted.
 * @returns A range suitable for decorations, hovers, and editor selections.
 */
export function annotationToRange(a: Annotation): vscode.Range {
  const { start, end, startChar, endChar } = a.range;

  if (isValidCharOffset(startChar) && isValidCharOffset(endChar)) {
    const reversedSingleLine = start === end && endChar < startChar;
    const zeroCoverageLastLine = end > start && endChar === 0;
    const safeEndChar = reversedSingleLine || zeroCoverageLastLine
      ? Number.MAX_SAFE_INTEGER // clamped to the actual line length by VS Code
      : endChar;
    return new vscode.Range(
      new vscode.Position(start, startChar),
      new vscode.Position(end, safeEndChar)
    );
  }

  // Legacy annotations without character info: highlight the full line span.
  return new vscode.Range(
    new vscode.Position(start, 0),
    new vscode.Position(end, Number.MAX_SAFE_INTEGER)
  );
}
