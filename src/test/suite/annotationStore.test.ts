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

  test('concurrent adds on cold cache do not lose annotations', async () => {
    // Pre-clear via a separate instance so `store` never touches the cache itself.
    const seeder = new AnnotationStore();
    await seeder.clear();

    // `coldStore` has never called any method — _cache is null.
    const coldStore = new AnnotationStore();
    await Promise.all([
      coldStore.add(makeAnnotation({ id: 'cold-1' })),
      coldStore.add(makeAnnotation({ id: 'cold-2' })),
      coldStore.add(makeAnnotation({ id: 'cold-3' })),
    ]);
    await coldStore.flush();

    const data = await coldStore.load();
    assert.strictEqual(
      data.annotations.length, 3,
      'All 3 concurrent cold-start adds must survive'
    );

    // Cleanup
    await coldStore.clear();
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

  test('add before switchSet writes to correct set files', async () => {
    // Pre-clean both sets so prior failed runs leave no stale data.
    store.switchSet('race-fix-test');
    await store.clear();
    store.switchSet('default');
    await store.clear();

    const now = new Date().toISOString();
    const ann1 = {
      id: 'race-default', fileUri: 'a.ts',
      range: { start: 0, end: 0 }, comment: 'for default',
      createdAt: now, updatedAt: now,
    };
    const ann2 = {
      id: 'race-other', fileUri: 'b.ts',
      range: { start: 0, end: 0 }, comment: 'for other',
      createdAt: now, updatedAt: now,
    };

    // Schedule flush for default without awaiting, then switch immediately.
    store.add(ann1);                  // do NOT await — flush is queued but not run
    store.switchSet('race-fix-test'); // switches _setName before flush executes
    await store.add(ann2);            // adds to race-fix-test
    await store.flush();              // drain the entire queue

    // 'default' set must have only ann1
    const defaultReader = new AnnotationStore();
    const defaultData = await defaultReader.load();
    assert.strictEqual(defaultData.annotations.length, 1, 'default set must have exactly 1 annotation');
    assert.strictEqual(defaultData.annotations[0].id, 'race-default');

    // 'race-fix-test' set must have only ann2
    const otherReader = new AnnotationStore();
    otherReader.switchSet('race-fix-test');
    const otherData = await otherReader.load();
    assert.strictEqual(otherData.annotations.length, 1, 'other set must have exactly 1 annotation');
    assert.strictEqual(otherData.annotations[0].id, 'race-other');

    // Cleanup
    store.switchSet('race-fix-test');
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

  test('insertion at annotation start shifts start and end (anchor fix)', async () => {
    // Annotation at lines 3–5; newline inserted at line 3 pushes content down.
    await store.add(makeAnnotation({ id: 'a', fileUri: 'src/foo.ts', range: { start: 3, end: 5 } }));
    await store.shiftAnnotations('src/foo.ts', [makeChange(3, 3, '\n')]);

    const [ann] = await store.getForFile('src/foo.ts');
    assert.strictEqual(ann.range.start, 4, 'start should shift when insertion is at annotation start');
    assert.strictEqual(ann.range.end, 6);
  });

  test('insertion strictly inside annotation span preserves start', async () => {
    // Annotation at lines 2–6; newline inserted at line 4 (inside the span).
    await store.add(makeAnnotation({ id: 'a', fileUri: 'src/foo.ts', range: { start: 2, end: 6 } }));
    await store.shiftAnnotations('src/foo.ts', [makeChange(4, 4, '\n')]);

    const [ann] = await store.getForFile('src/foo.ts');
    assert.strictEqual(ann.range.start, 2, 'start should not shift when change is inside span');
    assert.strictEqual(ann.range.end, 7);
  });

  test('insertion at line 0 shifts annotation at line 0', async () => {
    await store.add(makeAnnotation({ id: 'a', fileUri: 'src/foo.ts', range: { start: 0, end: 0 } }));
    await store.shiftAnnotations('src/foo.ts', [makeChange(0, 0, '\n')]);

    const [ann] = await store.getForFile('src/foo.ts');
    assert.strictEqual(ann.range.start, 1);
    assert.strictEqual(ann.range.end, 1);
  });

  test('shift preserves startChar and endChar (character-level range data)', async () => {
    // Annotation with character-level precision at lines 5–6; insert 2 lines before it.
    await store.add(makeAnnotation({
      id: 'a',
      fileUri: 'src/foo.ts',
      range: { start: 5, end: 6, startChar: 4, endChar: 12 },
    }));
    await store.shiftAnnotations('src/foo.ts', [makeChange(1, 1, 'new\nnew\n')]);

    const [ann] = await store.getForFile('src/foo.ts');
    assert.strictEqual(ann.range.start, 7, 'start should shift by 2');
    assert.strictEqual(ann.range.end, 8, 'end should shift by 2');
    assert.strictEqual(ann.range.startChar, 4, 'startChar must be preserved after shift');
    assert.strictEqual(ann.range.endChar, 12, 'endChar must be preserved after shift');
  });
});
