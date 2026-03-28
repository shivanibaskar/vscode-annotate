import * as path from 'path';
import Mocha = require('mocha');
import * as fs from 'fs';

export function run(): Promise<void> {
  const mocha = new Mocha({
    ui: 'tdd',
    color: true,
    timeout: 10_000,
  });

  const testsRoot = __dirname;
  const files = fs.readdirSync(testsRoot).filter(f => f.endsWith('.test.js'));
  files.forEach(f => mocha.addFile(path.join(testsRoot, f)));

  return new Promise((resolve, reject) => {
    mocha.run((failures: number) => {
      if (failures > 0) {
        reject(new Error(`${failures} test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
