import * as assert from 'assert';
import * as vscode from 'vscode';
import { ExportPreviewPanel } from '../../panels/exportPreviewPanel';

suite('ExportPreviewPanel.copyToClipboard', () => {
  let writtenText: string | undefined;
  let infoMessages: string[];
  let origClipboardDescriptor: PropertyDescriptor | undefined;
  let origInfo: typeof vscode.window.showInformationMessage;

  setup(() => {
    writtenText = undefined;
    infoMessages = [];

    // vscode.env.clipboard is read-only; use defineProperty to stub it.
    origClipboardDescriptor = Object.getOwnPropertyDescriptor(vscode.env, 'clipboard');
    Object.defineProperty(vscode.env, 'clipboard', {
      value: {
        writeText: async (text: string) => { writtenText = text; },
        readText: async () => '',
      },
      configurable: true,
    });

    origInfo = vscode.window.showInformationMessage;
    (vscode.window as any).showInformationMessage = (msg: string) => {
      infoMessages.push(msg);
      return Promise.resolve(undefined);
    };
  });

  teardown(() => {
    if (origClipboardDescriptor) {
      Object.defineProperty(vscode.env, 'clipboard', origClipboardDescriptor);
    }
    (vscode.window as any).showInformationMessage = origInfo;
  });

  test('writes the provided content to the clipboard', async () => {
    await ExportPreviewPanel.copyToClipboard('hello world');
    assert.strictEqual(writtenText, 'hello world');
  });

  test('shows an information message after copying', async () => {
    await ExportPreviewPanel.copyToClipboard('some context');
    assert.ok(infoMessages.length > 0, 'Expected an info message to be shown');
  });

  test('info message contains guidance about pasting into LLM', async () => {
    await ExportPreviewPanel.copyToClipboard('some context');
    const msg = infoMessages[0];
    assert.ok(
      msg.toLowerCase().includes('clipboard') && msg.toLowerCase().includes('llm'),
      `Expected message to mention clipboard and LLM, got: "${msg}"`
    );
  });

  test('writes full multi-line export content verbatim', async () => {
    const content = '=== ANNOTATED CODE CONTEXT ===\nFile: src/foo.ts\nCOMMENT: note\n=== END ===';
    await ExportPreviewPanel.copyToClipboard(content);
    assert.strictEqual(writtenText, content);
  });

  test('writes empty string without throwing', async () => {
    await assert.doesNotReject(() => ExportPreviewPanel.copyToClipboard(''));
    assert.strictEqual(writtenText, '');
  });
});
