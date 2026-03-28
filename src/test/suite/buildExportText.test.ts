import * as assert from 'assert';
import { AnnotationStore } from '../../annotationStore';
import { buildExportText } from '../../commands/buildExportText';

suite('buildExportText', () => {
  let store: AnnotationStore;
  const now = new Date().toISOString();

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
  });

  teardown(async () => {
    await store.clear();
  });

  test('returns null when there are no annotations', async () => {
    const result = await buildExportText(store);
    assert.strictEqual(result, null);
  });

  test('returns a string when annotations exist', async () => {
    await store.add({ id: '1', fileUri: 'src/a.ts', range: { start: 0, end: 0 }, comment: 'hello', createdAt: now, updatedAt: now });
    const result = await buildExportText(store);
    assert.ok(typeof result === 'string', 'Expected a string');
    assert.ok(result!.includes('hello'));
  });

  test('includes file path and comment in output', async () => {
    await store.add({ id: '2', fileUri: 'src/foo.ts', range: { start: 4, end: 6 }, comment: 'important note', createdAt: now, updatedAt: now });
    const result = await buildExportText(store);
    assert.ok(result!.includes('src/foo.ts'));
    assert.ok(result!.includes('important note'));
    assert.ok(result!.includes('Lines 5'));
  });

  test('prose files appear with CONTENT: label', async () => {
    await store.add({ id: '3', fileUri: 'docs/README.md', range: { start: 0, end: 0 }, comment: 'md note', createdAt: now, updatedAt: now });
    const result = await buildExportText(store);
    assert.ok(!result!.includes('```markdown'), 'Should not wrap prose in code fence');
  });
});
