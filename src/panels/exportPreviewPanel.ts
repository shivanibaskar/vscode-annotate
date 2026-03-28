import * as vscode from 'vscode';

function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class ExportPreviewPanel {
  private static current: ExportPreviewPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private content: string;

  private constructor(panel: vscode.WebviewPanel, content: string) {
    this.panel = panel;
    this.content = content;

    this.panel.webview.html = this.buildHtml();

    this.panel.webview.onDidReceiveMessage(msg => {
      if (msg.command === 'copy') {
        vscode.env.clipboard.writeText(this.content);
        vscode.window.showInformationMessage('Annotations copied to clipboard.');
      }
    });

    this.panel.onDidDispose(() => {
      ExportPreviewPanel.current = undefined;
    });
  }

  static show(content: string): void {
    if (ExportPreviewPanel.current) {
      ExportPreviewPanel.current.content = content;
      ExportPreviewPanel.current.panel.webview.html =
        ExportPreviewPanel.current.buildHtml();
      ExportPreviewPanel.current.panel.reveal();
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'annotate.exportPreview',
      'Annotation Export Preview',
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    ExportPreviewPanel.current = new ExportPreviewPanel(panel, content);
  }

  private buildHtml(): string {
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <style>
    body {
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      padding: 16px;
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
    }
    .toolbar {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }
    button {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 14px;
      cursor: pointer;
      border-radius: 2px;
      font-size: 13px;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .copied {
      color: var(--vscode-notificationsInfoIcon-foreground, #75beff);
      font-size: 12px;
      opacity: 0;
      transition: opacity 0.2s;
    }
    .copied.show { opacity: 1; }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
      background: var(--vscode-textCodeBlock-background);
      padding: 12px;
      border-radius: 4px;
      line-height: 1.5;
    }
  </style>
</head>
<body>
  <div class="toolbar">
    <button onclick="copy()">Copy to Clipboard</button>
    <span class="copied" id="copied">✓ Copied!</span>
  </div>
  <pre>${escapeHtml(this.content)}</pre>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    function copy() {
      vscode.postMessage({ command: 'copy' });
      const el = document.getElementById('copied');
      el.classList.add('show');
      setTimeout(() => el.classList.remove('show'), 2000);
    }
  </script>
</body>
</html>`;
  }
}
