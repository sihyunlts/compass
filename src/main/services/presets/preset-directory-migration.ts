import {
  access,
  lstat,
  mkdir,
  readdir,
  rename,
  rmdir,
} from 'node:fs/promises';
import path from 'node:path';

const pathExists = async (filePath: string): Promise<boolean> => {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
};

const resolveAvailableMigrationPath = async (
  desiredPath: string,
): Promise<string> => {
  if (!await pathExists(desiredPath)) {
    return desiredPath;
  }

  const parsed = path.parse(desiredPath);
  for (let suffix = 1; ; suffix += 1) {
    const label = suffix === 1 ? 'Migrated' : `Migrated ${suffix}`;
    const candidate = path.join(parsed.dir, `${parsed.name} (${label})${parsed.ext}`);
    if (!await pathExists(candidate)) {
      return candidate;
    }
  }
};

const mergeLegacyDirectory = async (
  sourceDirectory: string,
  targetDirectory: string,
): Promise<void> => {
  await mkdir(targetDirectory, { recursive: true });
  const entries = await readdir(sourceDirectory, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    if (entry.isDirectory() && await pathExists(targetPath)) {
      const targetStats = await lstat(targetPath);
      if (targetStats.isDirectory()) {
        await mergeLegacyDirectory(sourcePath, targetPath);
        continue;
      }
    }

    await rename(sourcePath, await resolveAvailableMigrationPath(targetPath));
  }

  await rmdir(sourceDirectory);
};

export interface PresetDirectoryMigration {
  sourceRelativePath: readonly string[];
  targetRelativePath: readonly string[];
}

// TODO(legacy-preset-migration): Remove each migration specification after its
// preset directory migration window has ended.
export const migratePresetDirectory = async (
  presetRootDirectory: string,
  migration: PresetDirectoryMigration,
): Promise<void> => {
  const sourceDirectory = path.join(
    presetRootDirectory,
    ...migration.sourceRelativePath,
  );
  const targetDirectory = path.join(
    presetRootDirectory,
    ...migration.targetRelativePath,
  );
  if (
    path.resolve(sourceDirectory) === path.resolve(targetDirectory)
    || !await pathExists(sourceDirectory)
  ) {
    return;
  }

  const sourceStats = await lstat(sourceDirectory);
  if (!sourceStats.isDirectory()) {
    return;
  }

  if (!await pathExists(targetDirectory)) {
    await mkdir(path.dirname(targetDirectory), { recursive: true });
    await rename(sourceDirectory, targetDirectory);
    return;
  }

  await mergeLegacyDirectory(sourceDirectory, targetDirectory);
};
