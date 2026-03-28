import * as assert from 'assert';
import * as vscode from 'vscode';
import { AnnotationStore } from '../../annotationStore';
import { exportForLLM } from '../../commands/exportForLLM';
import * as exportPreviewPanelModule from '../../panels/exportPreviewPanel';

suite('exportForLLM', () => {
  let store: AnnotationStore;
  let lastShownContent = '';
  let originalShow: typeof exportPreviewPanelModule.ExportPreviewPanel.show;

  setup(async () => {
    store = new AnnotationStore();
    await store.clear();
    lastShownContent = '';
    originalShow = exportPreviewPanelModule.ExportPreviewPanel.show;
    exportPreviewPanelModule.ExportPreviewPanel.show = (content: string) => {
      lastShownContent = content;
    };
  });

  teardown(async () => {
    exportPreviewPanelModule.ExportPreviewPanel.show = originalShow;
    await store.clear();
  });

  test('shows a warning when there are no annotations', async () => {
    const messages: string[] = [];
    const originalWarn = vscode.window.showWarningMessage;
    (vscode.window as any).showWarningMessage = (...args: any[]) => {
      messages.push(args[0]);
      return Promise.resolve(undefined);
    };

    try {
      await exportForLLM(store);
      assert.ok(
        messages.some(m => m.toLowerCase().includes('no annotations')),
        'Expected a "no annotations" warning'
      );
    } finally {
      (vscode.window as any).showWarningMessage = originalWarn;
    }
  });

  test('shows preview panel when annotations exist', async () => {
    await store.add({
      id: 'export-1',
      fileUri: 'src/foo.ts',
      range: { start: 0, end: 1 },
      comment: 'explains foo',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await exportForLLM(store);
    assert.ok(lastShownContent.includes('ANNOTATED CODE CONTEXT'), 'Expected header in output');
    assert.ok(lastShownContent.includes('src/foo.ts'), 'Expected file path in output');
    assert.ok(lastShownContent.includes('explains foo'), 'Expected comment in output');
  });

  test('output includes 1-based line numbers', async () => {
    await store.add({
      id: 'lines-1',
      fileUri: 'src/bar.ts',
      range: { start: 4, end: 7 }, // 0-based → should render as Lines 5–8
      comment: 'check line numbers',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await exportForLLM(store);
    assert.ok(lastShownContent.includes('Lines 5'), 'Expected 1-based start line');
    assert.ok(lastShownContent.includes('8'), 'Expected 1-based end line');
  });

  test('output groups annotations by file sorted alphabetically', async () => {
    const now = new Date().toISOString();
    await store.add({ id: '1', fileUri: 'src/alpha.ts', range: { start: 0, end: 0 }, comment: 'alpha note', createdAt: now, updatedAt: now });
    await store.add({ id: '2', fileUri: 'src/beta.ts',  range: { start: 0, end: 0 }, comment: 'beta note',  createdAt: now, updatedAt: now });

    await exportForLLM(store);
    const alphaPos = lastShownContent.indexOf('src/alpha.ts');
    const betaPos  = lastShownContent.indexOf('src/beta.ts');
    assert.ok(alphaPos !== -1, 'alpha.ts should appear in output');
    assert.ok(betaPos  !== -1, 'beta.ts should appear in output');
    assert.ok(alphaPos < betaPos, 'Files should be sorted alphabetically');
  });

  test('output includes TAG line when annotation has a tag', async () => {
    await store.add({
      id: 'tag-1',
      fileUri: 'src/tagged.ts',
      range: { start: 0, end: 0 },
      comment: 'this is a bug',
      tag: 'bug',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await exportForLLM(store);
    assert.ok(lastShownContent.includes('TAG: bug'), 'Expected TAG line in output');
  });

  test('output omits TAG line when annotation has no tag', async () => {
    await store.add({
      id: 'notag-1',
      fileUri: 'src/untagged.ts',
      range: { start: 0, end: 0 },
      comment: 'no tag here',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await exportForLLM(store);
    assert.ok(!lastShownContent.includes('TAG:'), 'Expected no TAG line in output');
  });

  test('default template wraps output in === markers', async () => {
    await store.add({
      id: 'tmpl-default',
      fileUri: 'src/a.ts',
      range: { start: 0, end: 0 },
      comment: 'note',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await exportForLLM(store);
    assert.ok(lastShownContent.includes('=== ANNOTATED CODE CONTEXT ==='), 'Expected default header');
    assert.ok(lastShownContent.includes('=== END OF ANNOTATIONS ==='), 'Expected default footer');
  });

  test('claude template wraps output in XML tags', async () => {
    await store.add({
      id: 'tmpl-claude',
      fileUri: 'src/a.ts',
      range: { start: 0, end: 0 },
      comment: 'note',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Override config to use claude template
    const origGet = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      const real = origGet.call(vscode.workspace, section);
      return {
        get: (key: string, def?: any) => {
          if (key === 'promptTemplate') { return 'claude'; }
          return real.get(key, def);
        },
      };
    };

    try {
      await exportForLLM(store);
      assert.ok(lastShownContent.includes('<annotated_context>'), 'Expected Claude XML header');
      assert.ok(lastShownContent.includes('</annotated_context>'), 'Expected Claude XML footer');
    } finally {
      (vscode.workspace as any).getConfiguration = origGet;
    }
  });

  test('gpt template wraps output in fenced block', async () => {
    await store.add({
      id: 'tmpl-gpt',
      fileUri: 'src/a.ts',
      range: { start: 0, end: 0 },
      comment: 'note',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const origGet = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      const real = origGet.call(vscode.workspace, section);
      return {
        get: (key: string, def?: any) => {
          if (key === 'promptTemplate') { return 'gpt'; }
          return real.get(key, def);
        },
      };
    };

    try {
      await exportForLLM(store);
      assert.ok(lastShownContent.includes('```annotated-context'), 'Expected GPT fenced header');
    } finally {
      (vscode.workspace as any).getConfiguration = origGet;
    }
  });

  test('custom template uses user-defined header and footer', async () => {
    await store.add({
      id: 'tmpl-custom',
      fileUri: 'src/a.ts',
      range: { start: 0, end: 0 },
      comment: 'note',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const origGet = vscode.workspace.getConfiguration;
    (vscode.workspace as any).getConfiguration = (section?: string) => {
      const real = origGet.call(vscode.workspace, section);
      return {
        get: (key: string, def?: any) => {
          if (key === 'promptTemplate') { return 'custom'; }
          if (key === 'promptTemplateCustom') { return 'MY HEADER|||MY FOOTER'; }
          return real.get(key, def);
        },
      };
    };

    try {
      await exportForLLM(store);
      assert.ok(lastShownContent.includes('MY HEADER'), 'Expected custom header');
      assert.ok(lastShownContent.includes('MY FOOTER'), 'Expected custom footer');
    } finally {
      (vscode.workspace as any).getConfiguration = origGet;
    }
  });
});
