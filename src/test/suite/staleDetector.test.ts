import * as assert from 'assert';
import { isAnnotationStale } from '../../staleDetector';
import { Annotation } from '../../types';

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  const now = new Date().toISOString();
  return {
    id: 'test-id',
    fileUri: 'src/foo.ts',
    range: { start: 0, end: 1 },
    comment: 'test comment',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

suite('isAnnotationStale', () => {
  test('returns false when annotation has no contentSnapshot', () => {
    const ann = makeAnnotation({ contentSnapshot: undefined });
    const doc = 'line one\nline two\nline three\n';
    assert.strictEqual(isAnnotationStale(ann, doc), false);
  });

  test('returns false when content matches snapshot', () => {
    const ann = makeAnnotation({
      range: { start: 0, end: 1 },
      contentSnapshot: 'line one\nline two',
    });
    const doc = 'line one\nline two\nline three\n';
    assert.strictEqual(isAnnotationStale(ann, doc), false);
  });

  test('returns true when content has changed from snapshot', () => {
    const ann = makeAnnotation({
      range: { start: 0, end: 1 },
      contentSnapshot: 'old content\nold line two',
    });
    const doc = 'new content\nnew line two\nline three\n';
    assert.strictEqual(isAnnotationStale(ann, doc), true);
  });

  test('returns true when annotated lines have been deleted (range out of bounds)', () => {
    const ann = makeAnnotation({
      range: { start: 5, end: 7 },
      contentSnapshot: 'some content',
    });
    const doc = 'only\nthree\nlines\n';
    assert.strictEqual(isAnnotationStale(ann, doc), true);
  });

  test('ignores trailing whitespace differences', () => {
    const ann = makeAnnotation({
      range: { start: 0, end: 0 },
      contentSnapshot: 'const x = 1;  ',
    });
    const doc = 'const x = 1;\n';
    assert.strictEqual(isAnnotationStale(ann, doc), false);
  });

  test('detects content change on single-line annotation', () => {
    const ann = makeAnnotation({
      range: { start: 1, end: 1 },
      contentSnapshot: 'return false;',
    });
    const doc = 'function foo() {\n  return true;\n}\n';
    assert.strictEqual(isAnnotationStale(ann, doc), true);
  });

  test('returns false for fresh annotation where content is unchanged', () => {
    const content = 'const a = 1;\nconst b = 2;';
    const ann = makeAnnotation({
      range: { start: 0, end: 1 },
      contentSnapshot: content,
    });
    assert.strictEqual(isAnnotationStale(ann, content + '\nconst c = 3;\n'), false);
  });

  test('returns false when start is in range but end exceeds file length (partial overlap)', () => {
    // A 3-line annotation at lines 1–3 in a file that now has only 3 lines (0–2).
    // start (1) is valid; end (3) is out of bounds. The annotation is partially
    // valid — the start line still exists — so it should NOT be considered stale
    // purely on the bounds check. The content comparison determines staleness.
    const ann = makeAnnotation({
      range: { start: 1, end: 3 },
      contentSnapshot: 'line two\nline three',
    });
    const doc = 'line one\nline two\nline three\n'; // 3 lines (indices 0-2), end=3 is out of bounds
    // Content at lines 1–2 is "line two\nline three", which matches the snapshot.
    assert.strictEqual(isAnnotationStale(ann, doc), false);
  });
});
