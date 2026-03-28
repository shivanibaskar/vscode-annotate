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
});
