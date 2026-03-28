import * as path from 'path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  const extensionDevelopmentPath = path.resolve(__dirname, '../../');
  const extensionTestsPath = path.resolve(__dirname, './suite/index');

  // Open the extension's own directory as the test workspace so
  // AnnotationStore has a workspaceFolders entry to write into.
  await runTests({
    extensionDevelopmentPath,
    extensionTestsPath,
    launchArgs: [extensionDevelopmentPath],
  });
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
