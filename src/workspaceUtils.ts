import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Converts a document URI to the workspace-relative path stored as an
 * annotation's `fileUri` key.
 *
 * In a single-folder workspace this is the plain folder-relative path
 * (unchanged from earlier extension versions, so existing annotation data
 * keeps matching). In a multi-root workspace the path is prefixed with the
 * containing folder's name (`folderName/rel/path.ts`) so it can later be
 * resolved back to the right folder unambiguously.
 *
 * Files outside every workspace folder return their full path unchanged,
 * mirroring `vscode.workspace.asRelativePath`.
 *
 * @param uri The document URI to convert.
 * @returns The relative path used as the annotation `fileUri` key.
 */
export function toFileUri(uri: vscode.Uri): string {
  // asRelativePath's default includeWorkspaceFolder prepends the folder name
  // only when the workspace has more than one folder.
  return vscode.workspace.asRelativePath(uri);
}

/**
 * Resolves an annotation `fileUri` back to an absolute workspace URI.
 *
 * In multi-root workspaces, a leading `folderName/` segment selects the
 * matching folder (longest folder-name match wins, so names containing `/`
 * still resolve). If no folder name matches — including all paths written by
 * older versions or in single-root workspaces — the path resolves against the
 * first workspace folder, preserving pre-multi-root behavior.
 *
 * Also enforces path containment: a crafted `fileUri` such as
 * `../../.ssh/id_rsa` that escapes the resolved folder returns `undefined`.
 *
 * @param fileUri The workspace-relative path stored on an annotation.
 * @returns The absolute URI, or `undefined` when no workspace folder is open
 *          or the path escapes its workspace folder.
 */
export function resolveFileUri(fileUri: string): vscode.Uri | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) { return undefined; }

  let folder = folders[0];
  let rel = fileUri;

  if (folders.length > 1) {
    // Longest-name match so a folder named "a/b" beats a folder named "a".
    let best: vscode.WorkspaceFolder | undefined;
    for (const f of folders) {
      if (fileUri.startsWith(f.name + '/') && (!best || f.name.length > best.name.length)) {
        best = f;
      }
    }
    if (best) {
      folder = best;
      rel = fileUri.slice(best.name.length + 1);
    }
  }

  // Containment guard — reject paths that resolve outside the chosen folder.
  const root = folder.uri.fsPath;
  const resolved = path.resolve(root, rel);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    return undefined;
  }

  return vscode.Uri.joinPath(folder.uri, rel);
}
