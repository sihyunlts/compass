import { readdirSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const isFullRun = process.argv.slice(2).includes('--full');
const repoRoot = path.resolve(__dirname, '..');
const binSuffix = process.platform === 'win32' ? '.cmd' : '';
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const run = (
  command: string,
  args: string[],
): void => {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  if (result.error) {
    console.error(`Failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

const collectTestFiles = (
  directory: string,
): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true });
  const testFiles: string[] = [];

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      testFiles.push(...collectTestFiles(entryPath));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      testFiles.push(entryPath);
    }
  }

  return testFiles.sort();
};

run(npmCommand, ['run', 'lint']);
const testFiles = collectTestFiles(path.join(repoRoot, 'src'));
if (testFiles.length > 0) {
  run(path.join(repoRoot, 'node_modules', '.bin', `tsx${binSuffix}`), [
    '--test',
    ...testFiles,
  ]);
}

if (isFullRun) {
  run(path.join(repoRoot, 'node_modules', '.bin', `tsc${binSuffix}`), [
    '--noEmit',
    '--module',
    'esnext',
  ]);
}
