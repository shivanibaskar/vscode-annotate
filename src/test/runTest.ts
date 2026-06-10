import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');

  // VS Code creates a unix socket inside the user-data dir. macOS caps socket
  // paths at 103 chars, so a deeply nested checkout (e.g. a git worktree)
  // breaks the default .vscode-test/user-data location. Use a short tmp dir.
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsa-test-'));

  // Open the extension's own directory as the test workspace so
  // AnnotationStore has a workspaceFolders entry to write into.
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [extensionDevelopmentPath, '--user-data-dir', userDataDir],
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
