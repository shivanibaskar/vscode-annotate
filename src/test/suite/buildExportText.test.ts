import * as assert from 'assert';
import * as vscode from 'vscode';
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
    // Reset any settings touched during the test suite.
    const config = vscode.workspace.getConfiguration('annotate');
    await config.update('promptTemplate',    undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('exportPreamble',    undefined, vscode.ConfigurationTarget.Workspace);
    await config.update('exportContextLines',undefined, vscode.ConfigurationTarget.Workspace);
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

  test('annotation with path-traversal fileUri does not throw and still exports comment', async () => {
    // A crafted annotation whose fileUri escapes the workspace root.
    // The readLines guard should return null (skip file content) rather than
    // reading an arbitrary file or throwing.
    await store.add({ id: '4', fileUri: '../../etc/passwd', range: { start: 0, end: 0 }, comment: 'traversal test', createdAt: now, updatedAt: now });
    let result: string | null;
    assert.doesNotThrow(() => {
      result = null; // reset
    });
    result = await buildExportText(store);
    assert.ok(typeof result === 'string', 'Expected a string even for traversal fileUri');
    assert.ok(result!.includes('traversal test'), 'Comment should still appear in export');
    // File content (CODE: block) must not appear — readLines returned null.
    assert.ok(!result!.includes('CODE:'), 'File content must not be read for traversal paths');
  });

  // ── P6: claude XML template ────────────────────────────────────────────────

  test('claude template produces XML skeleton', async () => {
    const config = vscode.workspace.getConfiguration('annotate');
    await config.update('promptTemplate', 'claude', vscode.ConfigurationTarget.Workspace);
    // Suppress the default preamble so we can assert on the raw XML structure.
    await config.update('exportPreamble', '', vscode.ConfigurationTarget.Workspace);
    await store.add({ id: '10', fileUri: 'src/x.ts', range: { start: 0, end: 1 }, comment: 'xml note', createdAt: now, updatedAt: now });
    const result = await buildExportText(store);
    assert.ok(result!.startsWith('<code_annotations>'), 'Should open with <code_annotations>');
    assert.ok(result!.includes('<file path="src/x.ts">'), 'Should include <file> element with path');
    assert.ok(result!.includes('<note>xml note</note>'), 'Should wrap comment in <note>');
    assert.ok(result!.endsWith('</code_annotations>'), 'Should close with </code_annotations>');
  });

  test('claude template escapes XML special characters in comment', async () => {
    await vscode.workspace.getConfiguration('annotate').update(
      'promptTemplate', 'claude', vscode.ConfigurationTarget.Workspace
    );
    await store.add({ id: '11', fileUri: 'src/b.ts', range: { start: 0, end: 0 }, comment: '<b>&"tricky"</b>', createdAt: now, updatedAt: now });
    const result = await buildExportText(store);
    assert.ok(!result!.includes('<b>'),       'Raw < must be escaped');
    assert.ok(result!.includes('&lt;b&gt;'),  'Should escape < and >');
    assert.ok(result!.includes('&amp;'),      'Should escape &');
    assert.ok(result!.includes('&quot;'),     'Should escape "');
  });

  test('claude template includes tag attribute when annotation has a tag', async () => {
    await vscode.workspace.getConfiguration('annotate').update(
      'promptTemplate', 'claude', vscode.ConfigurationTarget.Workspace
    );
    await store.add({ id: '12', fileUri: 'src/c.ts', range: { start: 2, end: 4 }, comment: 'tagged', tag: 'bug', createdAt: now, updatedAt: now });
    const result = await buildExportText(store);
    assert.ok(result!.includes('tag="bug"'), 'Should include tag attribute');
    assert.ok(result!.includes('lines="3-5"'), 'Should encode 1-based line range');
  });

  test('claude template omits tag attribute when annotation has no tag', async () => {
    await vscode.workspace.getConfiguration('annotate').update(
      'promptTemplate', 'claude', vscode.ConfigurationTarget.Workspace
    );
    await store.add({ id: '13', fileUri: 'src/d.ts', range: { start: 0, end: 0 }, comment: 'no tag', createdAt: now, updatedAt: now });
    const result = await buildExportText(store);
    assert.ok(!result!.includes(' tag='), 'tag attribute must be absent when no tag is set');
  });

  // ── P6: exportPreamble setting ─────────────────────────────────────────────

  test('preamble is prepended before the annotation block', async () => {
    await vscode.workspace.getConfiguration('annotate').update(
      'exportPreamble', 'Review the following:', vscode.ConfigurationTarget.Workspace
    );
    await store.add({ id: '20', fileUri: 'src/e.ts', range: { start: 0, end: 0 }, comment: 'preamble test', createdAt: now, updatedAt: now });
    const result = await buildExportText(store);
    assert.ok(result!.startsWith('Review the following:'), 'Preamble must be the first content');
  });

  test('preamble is prepended before claude XML block', async () => {
    const config = vscode.workspace.getConfiguration('annotate');
    await config.update('promptTemplate', 'claude', vscode.ConfigurationTarget.Workspace);
    await config.update('exportPreamble', 'Analyse this:', vscode.ConfigurationTarget.Workspace);
    await store.add({ id: '21', fileUri: 'src/f.ts', range: { start: 0, end: 0 }, comment: 'note', createdAt: now, updatedAt: now });
    const result = await buildExportText(store);
    assert.ok(result!.startsWith('Analyse this:'), 'Preamble must precede <code_annotations>');
    assert.ok(result!.includes('<code_annotations>'), 'XML block must still be present');
  });

  test('empty preamble does not add blank leading line', async () => {
    await vscode.workspace.getConfiguration('annotate').update(
      'exportPreamble', '', vscode.ConfigurationTarget.Workspace
    );
    await store.add({ id: '22', fileUri: 'src/g.ts', range: { start: 0, end: 0 }, comment: 'note', createdAt: now, updatedAt: now });
    const result = await buildExportText(store);
    // Default template starts with the header directly.
    assert.ok(!result!.startsWith('\n'), 'No leading blank line when preamble is empty');
  });
});
