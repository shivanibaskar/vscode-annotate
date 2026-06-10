import * as assert from 'assert';
import { Annotation, LineRange } from '../../types';
import { annotationToRange } from '../../rangeUtils';

function makeAnnotation(range: LineRange): Annotation {
  const now = new Date().toISOString();
  return {
    id: 'r1',
    fileUri: 'src/foo.ts',
    range,
    comment: 'range test',
    createdAt: now,
    updatedAt: now,
  };
}

suite('annotationToRange', () => {
  test('returns a character-precise range when char info is present', () => {
    const range = annotationToRange(makeAnnotation({ start: 2, end: 2, startChar: 4, endChar: 9 }));
    assert.strictEqual(range.start.line, 2);
    assert.strictEqual(range.start.character, 4);
    assert.strictEqual(range.end.line, 2);
    assert.strictEqual(range.end.character, 9);
  });

  test('falls back to the whole line span for legacy annotations without char info', () => {
    const range = annotationToRange(makeAnnotation({ start: 1, end: 3 }));
    assert.strictEqual(range.start.line, 1);
    assert.strictEqual(range.start.character, 0);
    assert.strictEqual(range.end.line, 3);
    assert.strictEqual(range.end.character, Number.MAX_SAFE_INTEGER);
  });

  test('falls back to the whole line span when only one char bound is present', () => {
    const range = annotationToRange(makeAnnotation({ start: 0, end: 0, startChar: 3 }));
    assert.strictEqual(range.start.character, 0);
    assert.strictEqual(range.end.character, Number.MAX_SAFE_INTEGER);
  });

  test('falls back to the whole line span when char info is negative', () => {
    const range = annotationToRange(makeAnnotation({ start: 0, end: 0, startChar: -2, endChar: 5 }));
    assert.strictEqual(range.start.character, 0);
    assert.strictEqual(range.end.character, Number.MAX_SAFE_INTEGER);
  });

  test('falls back to the whole line span when char info is not an integer', () => {
    const range = annotationToRange(makeAnnotation({ start: 0, end: 0, startChar: 1.5, endChar: NaN }));
    assert.strictEqual(range.start.character, 0);
    assert.strictEqual(range.end.character, Number.MAX_SAFE_INTEGER);
  });

  test('repairs a reversed single-line range by extending to end of line', () => {
    // Persisted by a pre-fix bug: selection (5,3)→(6,0) stored as endChar 0
    // on a single-line annotation, which vscode.Range would silently swap.
    const range = annotationToRange(makeAnnotation({ start: 5, end: 5, startChar: 3, endChar: 0 }));
    assert.strictEqual(range.start.line, 5);
    assert.strictEqual(range.start.character, 3);
    assert.strictEqual(range.end.line, 5);
    assert.strictEqual(range.end.character, Number.MAX_SAFE_INTEGER);
  });

  test('repairs a multi-line range whose endChar is 0 by extending to end of last line', () => {
    const range = annotationToRange(makeAnnotation({ start: 5, end: 6, startChar: 3, endChar: 0 }));
    assert.strictEqual(range.start.line, 5);
    assert.strictEqual(range.start.character, 3);
    assert.strictEqual(range.end.line, 6);
    assert.strictEqual(range.end.character, Number.MAX_SAFE_INTEGER);
  });

  test('keeps a legitimate multi-line range where endChar is smaller than startChar', () => {
    // Lines 5–6, starting at char 10 on line 5 and ending at char 5 on line 6
    // is a perfectly valid forward range — must not be treated as reversed.
    const range = annotationToRange(makeAnnotation({ start: 5, end: 6, startChar: 10, endChar: 5 }));
    assert.strictEqual(range.start.character, 10);
    assert.strictEqual(range.end.character, 5);
  });
});
