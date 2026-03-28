import * as assert from 'assert';
import { AnnotationStore } from '../../annotationStore';
import { Annotation } from '../../types';

function makeAnnotation(overrides: Partial<Annotation> = {}): Annotation {
  const now = new Date().toISOString();
  return {
    id: 'test-id',
    fileUri: 'src/foo.ts',
    range: { start: 0, end: 2 },
    comment: 'test comment',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

suite('AnnotationStore', () => {
  let store: AnnotationStore;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
  });

  teardown(async () => {
    await store.clear();
  });

  test('load returns empty annotations on fresh store', async () => {
    const data = await store.load();
    assert.strictEqual(data.version, 1);
    assert.deepStrictEqual(data.annotations, []);
  });

  test('add persists an annotation', async () => {
    const annotation = makeAnnotation({ id: 'add-1' });
    await store.add(annotation);

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 1);
    assert.strictEqual(data.annotations[0].id, 'add-1');
    assert.strictEqual(data.annotations[0].comment, 'test comment');
  });

  test('add accumulates multiple annotations', async () => {
    await store.add(makeAnnotation({ id: 'a' }));
    await store.add(makeAnnotation({ id: 'b' }));
    await store.add(makeAnnotation({ id: 'c' }));

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 3);
  });

  test('remove deletes only the target annotation by id', async () => {
    await store.add(makeAnnotation({ id: 'keep' }));
    await store.add(makeAnnotation({ id: 'delete-me' }));

    await store.remove('delete-me');

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 1);
    assert.strictEqual(data.annotations[0].id, 'keep');
  });

  test('remove with unknown id leaves store unchanged', async () => {
    await store.add(makeAnnotation({ id: 'existing' }));
    await store.remove('does-not-exist');

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 1);
  });

  test('clear removes all annotations', async () => {
    await store.add(makeAnnotation({ id: '1' }));
    await store.add(makeAnnotation({ id: '2' }));
    await store.clear();

    const data = await store.load();
    assert.deepStrictEqual(data.annotations, []);
  });

  test('getForFile returns only annotations for the given path', async () => {
    await store.add(makeAnnotation({ id: 'foo-1', fileUri: 'src/foo.ts' }));
    await store.add(makeAnnotation({ id: 'foo-2', fileUri: 'src/foo.ts' }));
    await store.add(makeAnnotation({ id: 'bar-1', fileUri: 'src/bar.ts' }));

    const fooAnnotations = await store.getForFile('src/foo.ts');
    assert.strictEqual(fooAnnotations.length, 2);
    assert.ok(fooAnnotations.every(a => a.fileUri === 'src/foo.ts'));
  });

  test('getForFile returns empty array when no annotations match', async () => {
    await store.add(makeAnnotation({ id: '1', fileUri: 'src/foo.ts' }));

    const result = await store.getForFile('src/unknown.ts');
    assert.deepStrictEqual(result, []);
  });

  test('persisted data survives a fresh store instance', async () => {
    await store.add(makeAnnotation({ id: 'persist-me', comment: 'survives reload' }));
    await store.flush(); // wait for disk write before a new instance reads

    const freshStore = new AnnotationStore();
    const data = await freshStore.load();
    assert.strictEqual(data.annotations.length, 1);
    assert.strictEqual(data.annotations[0].comment, 'survives reload');
  });

  test('update replaces the comment of an existing annotation', async () => {
    const ann = makeAnnotation({ id: 'upd-1', comment: 'original' });
    await store.add(ann);

    await store.update({ ...ann, comment: 'updated' });
    await store.flush();

    const data = await store.load();
    assert.strictEqual(data.annotations[0].comment, 'updated');
    assert.strictEqual(data.annotations[0].id, 'upd-1');
  });

  test('update stamps updatedAt later than createdAt', async () => {
    const ann = makeAnnotation({ id: 'upd-2' });
    await store.add(ann);

    // Ensure at least 1ms passes before updating
    await new Promise(r => setTimeout(r, 2));
    await store.update({ ...ann, comment: 'changed' });
    await store.flush();

    const data = await store.load();
    assert.ok(
      data.annotations[0].updatedAt > data.annotations[0].createdAt,
      'updatedAt should be later than createdAt'
    );
  });

  test('update with unknown id leaves store unchanged', async () => {
    const ann = makeAnnotation({ id: 'real' });
    await store.add(ann);

    await store.update({ ...ann, id: 'ghost', comment: 'noop' });

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 1);
    assert.strictEqual(data.annotations[0].comment, 'test comment');
  });

  test('update fires onDidChange', async () => {
    const ann = makeAnnotation({ id: 'fire-test' });
    await store.add(ann);

    let fired = false;
    store.onDidChange(() => { fired = true; });
    await store.update({ ...ann, comment: 'changed' });

    assert.strictEqual(fired, true);
  });

  test('concurrent adds do not lose annotations', async () => {
    // Fire 5 adds without awaiting each — they must all land in the cache.
    await Promise.all([
      store.add(makeAnnotation({ id: 'c1' })),
      store.add(makeAnnotation({ id: 'c2' })),
      store.add(makeAnnotation({ id: 'c3' })),
      store.add(makeAnnotation({ id: 'c4' })),
      store.add(makeAnnotation({ id: 'c5' })),
    ]);

    const data = await store.load();
    assert.strictEqual(data.annotations.length, 5);
  });
});

// ---------------------------------------------------------------------------
// switchSet
// ---------------------------------------------------------------------------

suite('AnnotationStore.switchSet', () => {
  let store: AnnotationStore;
  const now = new Date().toISOString();

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
  });

  teardown(async () => {
    // Clean up any named set files created during tests
    store.switchSet('default');
    await store.clear();
  });

  test('default setName is "default"', () => {
    assert.strictEqual(store.setName, 'default');
  });

  test('switchSet changes setName', () => {
    store.switchSet('my-set');
    assert.strictEqual(store.setName, 'my-set');
  });

  test('switchSet fires onDidChange', () => {
    let fired = false;
    store.onDidChange(() => { fired = true; });
    store.switchSet('another-set');
    assert.strictEqual(fired, true);
  });

  test('switchSet to same name does not fire onDidChange', () => {
    let count = 0;
    store.onDidChange(() => { count++; });
    store.switchSet('default'); // already 'default'
    assert.strictEqual(count, 0);
  });

  test('annotations are isolated between sets', async () => {
    await store.add({ id: 'default-ann', fileUri: 'src/a.ts', range: { start: 0, end: 0 }, comment: 'in default', createdAt: now, updatedAt: now });
    await store.flush();

    store.switchSet('other');
    const otherData = await store.load();
    assert.strictEqual(otherData.annotations.length, 0, 'Other set should start empty');

    await store.add({ id: 'other-ann', fileUri: 'src/a.ts', range: { start: 0, end: 0 }, comment: 'in other', createdAt: now, updatedAt: now });
    await store.flush();

    // Switch back and verify default set is untouched
    store.switchSet('default');
    const defaultData = await store.load();
    assert.strictEqual(defaultData.annotations.length, 1);
    assert.strictEqual(defaultData.annotations[0].id, 'default-ann');

    // Clean up the other set
    store.switchSet('other');
    await store.clear();
  });
});

// ---------------------------------------------------------------------------
// shiftAnnotations
// ---------------------------------------------------------------------------

import * as vscode from 'vscode';

function makeChange(
  startLine: number,
  endLine: number,
  text: string
): vscode.TextDocumentContentChangeEvent {
  return {
    range: new vscode.Range(startLine, 0, endLine, 0),
    text,
    rangeLength: 0,
    rangeOffset: 0,
  };
}

suite('AnnotationStore.shiftAnnotations', () => {
  let store: AnnotationStore;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
  });

  teardown(async () => {
    await store.clear();
  });

  test('shifts annotation down when lines inserted before it', async () => {
    // Annotation on lines 5-7; insert 3 lines before line 2.
    await store.add(makeAnnotation({ id: 'a', fileUri: 'src/foo.ts', range: { start: 5, end: 7 } }));
    await store.shiftAnnotations('src/foo.ts', [makeChange(2, 2, 'new\nnew\nnew\n')]);

    const [ann] = await store.getForFile('src/foo.ts');
    assert.strictEqual(ann.range.start, 8);
    assert.strictEqual(ann.range.end, 10);
  });

  test('shifts annotation up when lines deleted before it', async () => {
    // Annotation on lines 5-7; delete 2 lines (lines 1-2).
    await store.add(makeAnnotation({ id: 'a', fileUri: 'src/foo.ts', range: { start: 5, end: 7 } }));
    await store.shiftAnnotations('src/foo.ts', [makeChange(1, 3, '')]);

    const [ann] = await store.getForFile('src/foo.ts');
    assert.strictEqual(ann.range.start, 3);
    assert.strictEqual(ann.range.end, 5);
  });

  test('does not move annotation when change is after it', async () => {
    await store.add(makeAnnotation({ id: 'a', fileUri: 'src/foo.ts', range: { start: 0, end: 2 } }));
    await store.shiftAnnotations('src/foo.ts', [makeChange(10, 10, 'extra\n')]);

    const [ann] = await store.getForFile('src/foo.ts');
    assert.strictEqual(ann.range.start, 0);
    assert.strictEqual(ann.range.end, 2);
  });

  test('removes annotation when its range becomes invalid after deletion', async () => {
    // Annotation on lines 3-4; delete those exact lines.
    await store.add(makeAnnotation({ id: 'a', fileUri: 'src/foo.ts', range: { start: 3, end: 4 } }));
    await store.shiftAnnotations('src/foo.ts', [makeChange(3, 5, '')]);

    const anns = await store.getForFile('src/foo.ts');
    assert.strictEqual(anns.length, 0, 'Annotation with invalid range should be removed');
  });

  test('does not affect annotations in other files', async () => {
    await store.add(makeAnnotation({ id: 'other', fileUri: 'src/bar.ts', range: { start: 2, end: 4 } }));
    await store.shiftAnnotations('src/foo.ts', [makeChange(0, 0, 'inserted\n')]);

    const [ann] = await store.getForFile('src/bar.ts');
    assert.strictEqual(ann.range.start, 2);
    assert.strictEqual(ann.range.end, 4);
  });
});
