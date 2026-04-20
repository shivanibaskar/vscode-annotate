import * as vscode from 'vscode';
import { AnnotationStore } from '../annotationStore';
import { buildExportText } from './buildExportText';

/**
 * Injects the current annotation export into an active VS Code terminal
 * **without submitting** (no trailing newline), so the user can append their
 * question and press Enter themselves.
 *
 * Workflow:
 *   1. Claude Code is running in a VS Code integrated terminal.
 *   2. User annotates code, then runs this command (Cmd+Shift+T).
 *   3. The export text appears in Claude Code's input buffer.
 *   4. User types their question and presses Enter.
 *
 * If multiple terminals are open, a picker lets the user choose which one
 * to target. The choice is remembered for the session.
 *
 * @param store - The active annotation store.
 */
export async function exportToTerminal(store: AnnotationStore): Promise<void> {
  const output = await buildExportText(store);

  if (output === null) {
    vscode.window.showWarningMessage('Annotate: No annotations to export.');
    return;
  }

  const terminal = await resolveTerminal();
  if (!terminal) { return; } // user cancelled picker

  // sendText with addNewLine=false injects text into the terminal's input
  // buffer without pressing Enter — the user appends their question first.
  terminal.sendText(output, false);
  terminal.show(false); // reveal without stealing focus from the editor

  vscode.window.showInformationMessage(
    'Annotate: Context sent to terminal. Add your question and press Enter.'
  );
}

// ---------------------------------------------------------------------------
// Terminal resolution
// ---------------------------------------------------------------------------

// Use terminal.name as the stable identity key — processId is not part of
// the public VS Code API and may be undefined on remote/WSL targets.
let _lastTerminalName: string | undefined;

/**
 * Clears the remembered terminal when it closes, so the next invocation
 * shows the picker rather than silently targeting a dead terminal.
 */
export function registerTerminalCloseListener(context: { subscriptions: { dispose(): void }[] }): void {
  context.subscriptions.push(
    vscode.window.onDidCloseTerminal(t => {
      if (t.name === _lastTerminalName) {
        _lastTerminalName = undefined;
      }
    })
  );
}

async function resolveTerminal(): Promise<vscode.Terminal | undefined> {
  const terminals = vscode.window.terminals;

  if (terminals.length === 0) {
    vscode.window.showWarningMessage(
      'Annotate: No open terminals. Open a terminal running Claude Code first.'
    );
    return undefined;
  }

  // Single terminal — use it directly.
  if (terminals.length === 1) {
    _lastTerminalName = terminals[0].name;
    return terminals[0];
  }

  // Prefer the previously used terminal if it is still alive.
  if (_lastTerminalName !== undefined) {
    const last = terminals.find(t => t.name === _lastTerminalName);
    if (last) { return last; }
  }

  // Multiple terminals — let the user pick.
  interface TerminalItem extends vscode.QuickPickItem { terminal: vscode.Terminal; }

  const items: TerminalItem[] = terminals.map(t => ({
    label: t.name,
    description: t === vscode.window.activeTerminal ? '(active)' : undefined,
    terminal: t,
  }));

  const picked = await vscode.window.showQuickPick(items, {
    placeHolder: 'Select the terminal running Claude Code…',
    ignoreFocusOut: true,
  });

  if (!picked) { return undefined; }

  _lastTerminalName = picked.terminal.name;
  return picked.terminal;
}
