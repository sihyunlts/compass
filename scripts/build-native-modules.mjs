import { existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'darwin') {
  process.exit(0);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const readArgument = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const outputRoot = path.resolve(
  readArgument('--output-root') ?? repoRoot,
);
const outputDir = path.join(
  outputRoot,
  'native',
  'macos',
  'build',
  'Release',
);

const nativeModules = [
  {
    output: 'compass_touchbar.node',
    sources: ['native/macos/touchbar.mm'],
    frameworks: ['AppKit'],
  },
  {
    output: 'compass_haptics.node',
    sources: ['native/macos/haptics.mm'],
    frameworks: ['AppKit'],
  },
];

const nodePrefix = path.resolve(
  path.dirname(process.execPath),
  '..',
);
const nodeIncludeDir = path.join(
  nodePrefix,
  'include',
  'node',
);

if (!existsSync(path.join(nodeIncludeDir, 'node_api.h'))) {
  console.error(
    `Could not find Node headers at ${nodeIncludeDir}.`,
  );
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });

const requestedArch =
  readArgument('--arch')
  ?? process.env.npm_config_arch
  ?? process.arch;

const clangArchs = requestedArch === 'arm64'
  ? ['arm64']
  : requestedArch === 'x64'
    ? ['x86_64']
    : requestedArch === 'universal'
      ? ['arm64', 'x86_64']
      : null;

if (!clangArchs) {
  console.error(
    `Unsupported macOS native build architecture: ${requestedArch}`,
  );
  process.exit(1);
}

for (const nativeModule of nativeModules) {
  const result = spawnSync(
    'xcrun',
    [
      'clang++',
      '-std=c++17',
      '-stdlib=libc++',
      '-fobjc-arc',
      '-bundle',
      '-undefined',
      'dynamic_lookup',
      '-mmacosx-version-min=11.0',
      ...clangArchs.flatMap((arch) => ['-arch', arch]),
      '-I',
      nodeIncludeDir,
      ...nativeModule.frameworks.flatMap((framework) => [
        '-framework',
        framework,
      ]),
      ...nativeModule.sources.map((source) => path.join(repoRoot, source)),
      '-o',
      path.join(outputDir, nativeModule.output),
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
    },
  );

  if (result.error) {
    console.error(
      `Failed to launch xcrun: ${result.error.message}`,
    );
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
