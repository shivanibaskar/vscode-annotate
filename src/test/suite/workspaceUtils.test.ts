import * as assert from 'assert';
import * as vscode from 'vscode';
import { toFileUri, resolveFileUri } from '../../workspaceUtils';
import { AnnotationStore, SET_NAME_PATTERN } from '../../annotationStore';

// The test harness opens a single-root workspace (the extension directory),
// so multi-root prefix behavior is exercised only at the unit level here:
// toFileUri must stay identical to the legacy asRelativePath(uri, false)
// output, and resolveFileUri must invert it.

suite('workspaceUtils', () => {
  function workspaceRoot(): vscode.Uri {
    const folders = vscode.workspace.workspaceFolders;
    assert.ok(folders && folders.length > 0, 'Test harness must open a workspace');
    return folders[0].uri;
  }

  test('toFileUri returns a folder-relative path in a single-root workspace', () => {
    const uri = vscode.Uri.joinPath(workspaceRoot(), 'src', 'extension.ts');
    assert.strictEqual(toFileUri(uri), 'src/extension.ts');
  });

  test('toFileUri matches legacy asRelativePath(uri, false) output', () => {
    const uri = vscode.Uri.joinPath(workspaceRoot(), 'package.json');
    assert.strictEqual(toFileUri(uri), vscode.workspace.asRelativePath(uri, false));
  });

  test('resolveFileUri inverts toFileUri', () => {
    const original = vscode.Uri.joinPath(workspaceRoot(), 'src', 'extension.ts');
    const resolved = resolveFileUri(toFileUri(original));
    assert.ok(resolved, 'Expected a resolved URI');
    assert.strictEqual(resolved.fsPath, original.fsPath);
  });

  test('resolveFileUri resolves plain relative paths against the first folder', () => {
    const resolved = resolveFileUri('src/foo.ts');
    assert.ok(resolved, 'Expected a resolved URI');
    assert.strictEqual(
      resolved.fsPath,
      vscode.Uri.joinPath(workspaceRoot(), 'src/foo.ts').fsPath
    );
  });

  test('resolveFileUri rejects paths escaping the workspace', () => {
    assert.strictEqual(resolveFileUri('../../.ssh/id_rsa'), undefined);
    assert.strictEqual(resolveFileUri('../sibling.txt'), undefined);
  });

  test('resolveFileUri allows dot segments that stay inside the workspace', () => {
    const resolved = resolveFileUri('src/../package.json');
    assert.ok(resolved, 'Expected a resolved URI');
    assert.strictEqual(
      resolved.fsPath,
      vscode.Uri.joinPath(workspaceRoot(), 'package.json').fsPath
    );
  });
});

suite('SET_NAME_PATTERN', () => {
  test('accepts sanitised branch-style names', () => {
    for (const name of ['main', 'release-1.2.0', 'feat_x', 'a.b-c_d', 'default']) {
      assert.ok(SET_NAME_PATTERN.test(name), `Expected "${name}" to be accepted`);
    }
  });

  test('rejects names with path separators or other unsafe characters', () => {
    for (const name of ['', 'a/b', 'a\\b', 'a b', 'evil/../../x', 'a:b', 'ä']) {
      assert.ok(!SET_NAME_PATTERN.test(name), `Expected "${name}" to be rejected`);
    }
  });
});

suite('AnnotationStore active-set pointer', () => {
  const POINTER_PATH = '.vscode/annotate-active-set.json';
  let store: AnnotationStore;

  function pointerUri(): vscode.Uri {
    const folders = vscode.workspace.workspaceFolders!;
    return vscode.Uri.joinPath(folders[0].uri, POINTER_PATH);
  }

  async function readPointer(): Promise<{ set?: string } | undefined> {
    try {
      const raw = await vscode.workspace.fs.readFile(pointerUri());
      return JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      return undefined;
    }
  }

  async function deletePointer(): Promise<void> {
    try {
      await vscode.workspace.fs.delete(pointerUri());
    } catch {
      // Already absent.
    }
  }

  setup(async () => {
    store = new AnnotationStore();
    await deletePointer();
  });

  teardown(async () => {
    // Return to the default set and remove test artifacts.
    store.switchSet('default');
    await store.clear();
    await deletePointer();
    store.dispose();
  });

  test('switchSet writes the pointer file after flush', async () => {
    store.switchSet('pointer-test');
    await store.flush();
    const pointer = await readPointer();
    assert.deepStrictEqual(pointer, { set: 'pointer-test' });
  });

  test('switching back to default updates the existing pointer', async () => {
    store.switchSet('pointer-test');
    await store.flush();
    store.switchSet('default');
    await store.flush();
    const pointer = await readPointer();
    assert.deepStrictEqual(pointer, { set: 'default' });
  });

  test('syncActiveSetPointer does not create the file by default', async () => {
    store.syncActiveSetPointer();
    await store.flush();
    assert.strictEqual(await readPointer(), undefined);
  });

  test('syncActiveSetPointer corrects a stale existing pointer', async () => {
    const stale = Buffer.from(JSON.stringify({ set: 'ghost-set' }), 'utf8');
    await vscode.workspace.fs.writeFile(pointerUri(), stale);
    store.syncActiveSetPointer();
    await store.flush();
    const pointer = await readPointer();
    assert.deepStrictEqual(pointer, { set: 'default' });
  });

  test('listSets accepts dotted set names', async () => {
    store.switchSet('release-1.2.0');
    await store.add({
      id: 'dotted-set-ann',
      fileUri: 'src/foo.ts',
      range: { start: 0, end: 1 },
      comment: 'dotted set test',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await store.flush();

    const sets = await AnnotationStore.listSets();
    assert.ok(sets.includes('release-1.2.0'), `Expected dotted set in ${JSON.stringify(sets)}`);

    // Clean up the set file created by this test.
    await store.clear();
    const folders = vscode.workspace.workspaceFolders!;
    const setFile = vscode.Uri.joinPath(folders[0].uri, '.vscode/annotations-release-1.2.0.json');
    try {
      await vscode.workspace.fs.delete(setFile);
    } catch {
      // Already absent.
    }
  });
});
