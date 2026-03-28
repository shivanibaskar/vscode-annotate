import * as assert from 'assert';
import { AnnotationStore } from '../../annotationStore';
import { AnnotationsTreeProvider, FileNode, AnnotationNode } from '../../annotationsTreeProvider';
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

suite('AnnotationsTreeProvider', () => {
  let store: AnnotationStore;
  let provider: AnnotationsTreeProvider;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    provider = new AnnotationsTreeProvider(store);
  });

  teardown(async () => {
    provider.dispose();
    await store.clear();
    store.dispose();
  });

  // -------------------------------------------------------------------------
  // Root children
  // -------------------------------------------------------------------------

  test('empty store returns no root children', async () => {
    const children = await provider.getChildren();
    assert.deepStrictEqual(children, []);
  });

  test('annotations grouped into one FileNode per file', async () => {
    const now = new Date().toISOString();
    await store.add(makeAnnotation({ id: '1', fileUri: 'src/foo.ts' }));
    await store.add(makeAnnotation({ id: '2', fileUri: 'src/foo.ts' }));
    await store.add(makeAnnotation({ id: '3', fileUri: 'src/bar.ts' }));

    const children = await provider.getChildren();
    assert.strictEqual(children.length, 2);
    assert.ok(children.every(c => c instanceof FileNode));
  });

  test('FileNodes are sorted alphabetically by path', async () => {
    const now = new Date().toISOString();
    await store.add(makeAnnotation({ id: 'z', fileUri: 'src/zoo.ts' }));
    await store.add(makeAnnotation({ id: 'a', fileUri: 'src/alpha.ts' }));
    await store.add(makeAnnotation({ id: 'm', fileUri: 'src/mid.ts' }));

    const children = (await provider.getChildren()) as FileNode[];
    assert.strictEqual(children[0].fileUri, 'src/alpha.ts');
    assert.strictEqual(children[1].fileUri, 'src/mid.ts');
    assert.strictEqual(children[2].fileUri, 'src/zoo.ts');
  });

  test('FileNode label is the basename only', async () => {
    await store.add(makeAnnotation({ id: '1', fileUri: 'src/deeply/nested/file.ts' }));

    const [node] = (await provider.getChildren()) as FileNode[];
    assert.strictEqual(node.label, 'file.ts');
  });

  test('FileNode description is singular for 1 annotation', async () => {
    await store.add(makeAnnotation({ id: '1', fileUri: 'src/foo.ts' }));

    const [node] = (await provider.getChildren()) as FileNode[];
    assert.strictEqual(node.description, '1 annotation');
  });

  test('FileNode description is plural for multiple annotations', async () => {
    await store.add(makeAnnotation({ id: '1', fileUri: 'src/foo.ts' }));
    await store.add(makeAnnotation({ id: '2', fileUri: 'src/foo.ts' }));
    await store.add(makeAnnotation({ id: '3', fileUri: 'src/foo.ts' }));

    const [node] = (await provider.getChildren()) as FileNode[];
    assert.strictEqual(node.description, '3 annotations');
  });

  // -------------------------------------------------------------------------
  // File children (AnnotationNodes)
  // -------------------------------------------------------------------------

  test('getChildren(FileNode) returns AnnotationNodes sorted by start line', async () => {
    await store.add(makeAnnotation({ id: 'late',  fileUri: 'src/foo.ts', range: { start: 10, end: 10 } }));
    await store.add(makeAnnotation({ id: 'early', fileUri: 'src/foo.ts', range: { start: 2,  end: 3  } }));

    const [fileNode] = (await provider.getChildren()) as FileNode[];
    const annNodes = (await provider.getChildren(fileNode)) as AnnotationNode[];

    assert.strictEqual(annNodes.length, 2);
    assert.strictEqual(annNodes[0].annotation.id, 'early');
    assert.strictEqual(annNodes[1].annotation.id, 'late');
  });

  test('AnnotationNode label is truncated at 60 chars with ellipsis', async () => {
    const longComment = 'A'.repeat(80);
    await store.add(makeAnnotation({ id: '1', comment: longComment }));

    const [fileNode] = (await provider.getChildren()) as FileNode[];
    const [annNode] = (await provider.getChildren(fileNode)) as AnnotationNode[];

    assert.ok((annNode.label as string).endsWith('…'), 'Label should end with ellipsis');
    assert.strictEqual((annNode.label as string).length, 61, 'Label should be 60 chars + ellipsis');
  });

  test('AnnotationNode label is not truncated when comment is short', async () => {
    await store.add(makeAnnotation({ id: '1', comment: 'short comment' }));

    const [fileNode] = (await provider.getChildren()) as FileNode[];
    const [annNode] = (await provider.getChildren(fileNode)) as AnnotationNode[];

    assert.strictEqual(annNode.label, 'short comment');
  });

  test('AnnotationNode description shows "Lines X–Y" in 1-based numbers', async () => {
    await store.add(makeAnnotation({ id: '1', range: { start: 4, end: 6 } }));

    const [fileNode] = (await provider.getChildren()) as FileNode[];
    const [annNode] = (await provider.getChildren(fileNode)) as AnnotationNode[];

    assert.strictEqual(annNode.description, 'Lines 5–7');
  });

  test('AnnotationNode description shows "Line X" for single-line annotations', async () => {
    await store.add(makeAnnotation({ id: '1', range: { start: 3, end: 3 } }));

    const [fileNode] = (await provider.getChildren()) as FileNode[];
    const [annNode] = (await provider.getChildren(fileNode)) as AnnotationNode[];

    assert.strictEqual(annNode.description, 'Line 4');
  });

  test('AnnotationNode command targets revealAnnotation with annotation as argument', async () => {
    const ann = makeAnnotation({ id: 'cmd-test', comment: 'navigate me' });
    await store.add(ann);

    const [fileNode] = (await provider.getChildren()) as FileNode[];
    const [annNode] = (await provider.getChildren(fileNode)) as AnnotationNode[];

    assert.strictEqual(annNode.command?.command, 'annotate.revealAnnotation');
    assert.deepStrictEqual(annNode.command?.arguments?.[0], annNode.annotation);
  });

  test('getChildren(AnnotationNode) returns empty array (leaf node)', async () => {
    await store.add(makeAnnotation({ id: '1' }));
    const [fileNode] = (await provider.getChildren()) as FileNode[];
    const [annNode] = (await provider.getChildren(fileNode)) as AnnotationNode[];

    const leafChildren = await provider.getChildren(annNode);
    assert.deepStrictEqual(leafChildren, []);
  });

  // -------------------------------------------------------------------------
  // Change notification
  // -------------------------------------------------------------------------

  test('onDidChangeTreeData fires when store adds an annotation', async () => {
    let fired = false;
    provider.onDidChangeTreeData(() => { fired = true; });

    await store.add(makeAnnotation({ id: 'trigger' }));
    assert.strictEqual(fired, true, 'Expected onDidChangeTreeData to fire on store.add');
  });
});
