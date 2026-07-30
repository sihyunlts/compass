import { app, shell } from 'electron';
import { randomUUID } from 'node:crypto';
import { constants, type Dirent } from 'node:fs';
import {
  access,
  copyFile,
  link,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rmdir,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import {
  GENERATE_DEVICE_CATEGORY_DIRECTORY_NAME,
} from '../../../devices/browser-categories';
import { getRendererDeviceLabel } from '../../../devices/schema-registry';
import type {
  MovedPresetEntry,
  ReadPresetEntryResponse,
} from '../../../shared/contracts/ipc/presets';
import type { PresetEntryMovePlan } from '../../../shared/preset-entry-move';
import {
  parsePresetFileText,
  type PresetFile,
  type PresetFileKind,
} from '../../../shared/presets';
import { PRESET_FILE_SPECS, PRESET_ROOT_DIR_NAME } from './preset-config';
import {
  migratePresetDirectory,
  type PresetDirectoryMigration,
} from './preset-directory-migration';
import {
  isValidPresetPathSegment,
  normalizePresetPathSegment,
  resolvePresetPath,
  ensurePresetExtension,
  sanitizeFileStem,
} from './preset-paths';

const DEVICE_PRESET_DIRECTORY_MIGRATIONS = [
  {
    sourceRelativePath: ['Generators'],
    targetRelativePath: [GENERATE_DEVICE_CATEGORY_DIRECTORY_NAME],
  },
  {
    sourceRelativePath: [
      GENERATE_DEVICE_CATEGORY_DIRECTORY_NAME,
      'Waterdrop',
    ],
    targetRelativePath: [
      GENERATE_DEVICE_CATEGORY_DIRECTORY_NAME,
      getRendererDeviceLabel('ripple'),
    ],
  },
] as const satisfies readonly PresetDirectoryMigration[];

const migrateDevicePresetDirectories = async (
  devicePresetDirectory: string,
): Promise<void> => {
  for (const migration of DEVICE_PRESET_DIRECTORY_MIGRATIONS) {
    await migratePresetDirectory(devicePresetDirectory, migration);
  }
};

const serializePresetFile = (payload: PresetFile): unknown => {
  if (payload.presetType === 'device') {
    return {
      ...payload,
      device: {
        ...payload.device,
        name: undefined,
      },
    };
  }

  if (payload.presetType === 'group') {
    return {
      ...payload,
      group: {
        ...payload.group,
        name: undefined,
      },
    };
  }

  return {
    ...payload,
    chain: {
      ...payload.chain,
      name: undefined,
    },
  };
};

const isCaseOnlyPathChange = (
  sourcePath: string,
  targetPath: string,
): boolean => {
  const source = path.resolve(sourcePath);
  const target = path.resolve(targetPath);
  return source !== target
    && source.toLocaleLowerCase('en-US') === target.toLocaleLowerCase('en-US');
};

interface PresetStorageEntryMove {
  entryKind: 'file' | 'directory';
  sourcePath: string;
  filePath: string;
}

type PresetStorageEntry = Omit<PresetStorageEntryMove, 'sourcePath'>;

/** Reads and writes preset files under the app's preset root. */
export class PresetStorage {
  private deviceDirectoryMigration: Promise<void> | null = null;

  private presetEntryMutationQueue: Promise<void> = Promise.resolve();

  public async resolvePresetsRootDirectory(): Promise<string> {
    const directory = path.join(app.getPath('userData'), PRESET_ROOT_DIR_NAME);
    await mkdir(directory, { recursive: true });
    return directory;
  }

  public async resolvePresetDirectory(
    presetType: PresetFileKind,
  ): Promise<string> {
    const directory = path.join(
      await this.resolvePresetsRootDirectory(),
      PRESET_FILE_SPECS[presetType].directory,
    );
    await mkdir(directory, { recursive: true });
    if (presetType === 'device') {
      this.deviceDirectoryMigration ??= migrateDevicePresetDirectories(directory);
      await this.deviceDirectoryMigration;
    }
    return directory;
  }

  public async writePresetFile(filePath: string, payload: PresetFile): Promise<void> {
    await this.enqueuePresetEntryMutation(async () => {
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify(serializePresetFile(payload), null, 2)}\n`, 'utf8');
    });
  }

  public async renamePresetFile(
    filePath: string,
    fileName: string,
    extension: string,
  ): Promise<string> {
    const nextFileName = ensurePresetExtension(
      sanitizeFileStem(fileName, path.parse(filePath).name),
      extension,
    );
    const targetPath = path.join(path.dirname(filePath), nextFileName);
    if (path.resolve(filePath) === path.resolve(targetPath)) {
      return targetPath;
    }

    await this.enqueuePresetEntryMutation(() =>
      this.moveExistingPresetEntry(
        {
          entryKind: 'file',
          sourcePath: filePath,
          filePath: targetPath,
        },
        'File does not exist.',
      )
    );

    return targetPath;
  }

  public async createPresetFolder(
    presetType: PresetFileKind,
    parentRelativePath: readonly string[],
    folderName: string,
  ): Promise<string[]> {
    const normalizedFolderName = normalizePresetPathSegment(folderName);
    if (!isValidPresetPathSegment(normalizedFolderName)) {
      throw new Error('Invalid folder name.');
    }

    const rootDirectory = await this.resolvePresetDirectory(presetType);
    const parentDirectory = resolvePresetPath(rootDirectory, parentRelativePath);
    if (!parentDirectory) {
      throw new Error('Invalid preset folder path.');
    }

    const relativePath = [...parentRelativePath, normalizedFolderName];
    const directoryPath = resolvePresetPath(rootDirectory, relativePath);
    if (!directoryPath) {
      throw new Error('Invalid preset folder path.');
    }

    await this.enqueuePresetEntryMutation(async () => {
      try {
        await this.ensureDirectoryEntryNameAvailable(
          parentDirectory,
          normalizedFolderName,
        );
        await mkdir(directoryPath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EEXIST') {
          throw new Error('An item or folder with that name already exists.', { cause: error });
        }
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          throw new Error('Parent folder does not exist.', { cause: error });
        }

        throw error;
      }
    });

    return relativePath;
  }

  public async renamePresetFolder(
    presetType: PresetFileKind,
    relativePath: readonly string[],
    folderName: string,
  ): Promise<{
    relativePath: string[];
    sourcePath: string;
    filePath: string;
  }> {
    if (relativePath.length === 0) {
      throw new Error('Preset root folders cannot be renamed.');
    }

    const normalizedFolderName = normalizePresetPathSegment(folderName);
    if (!isValidPresetPathSegment(normalizedFolderName)) {
      throw new Error('Invalid folder name.');
    }

    const rootDirectory = await this.resolvePresetDirectory(presetType);
    const sourceDirectory = resolvePresetPath(rootDirectory, relativePath);
    if (!sourceDirectory) {
      throw new Error('Invalid preset folder path.');
    }

    const parentRelativePath = relativePath.slice(0, -1);
    const nextRelativePath = [...parentRelativePath, normalizedFolderName];
    if (nextRelativePath.every((segment, index) => segment === relativePath[index])) {
      return {
        relativePath: nextRelativePath,
        sourcePath: sourceDirectory,
        filePath: sourceDirectory,
      };
    }

    const targetDirectory = resolvePresetPath(rootDirectory, nextRelativePath);
    if (!targetDirectory) {
      throw new Error('Invalid preset folder path.');
    }

    await this.enqueuePresetEntryMutation(() =>
      this.moveExistingPresetEntry(
        {
          entryKind: 'directory',
          sourcePath: sourceDirectory,
          filePath: targetDirectory,
        },
        'Folder does not exist.',
      )
    );

    return {
      relativePath: nextRelativePath,
      sourcePath: sourceDirectory,
      filePath: targetDirectory,
    };
  }

  public async movePresetEntries(
    presetType: PresetFileKind,
    plans: readonly PresetEntryMovePlan[],
    destinationRelativePath: readonly string[],
    createDestination: boolean,
  ): Promise<MovedPresetEntry[]> {
    return this.enqueuePresetEntryMutation(() =>
      this.performPresetEntriesMove(
        presetType,
        plans,
        destinationRelativePath,
        createDestination,
      )
    );
  }

  public async trashPresetEntries(
    entries: readonly PresetStorageEntry[],
  ): Promise<void> {
    await this.enqueuePresetEntryMutation(async () => {
      for (const entry of entries) {
        await this.ensurePresetEntryKind(entry.filePath, entry.entryKind);
      }
      for (const entry of entries) {
        await shell.trashItem(entry.filePath);
      }
    });
  }

  private async performPresetEntriesMove(
    presetType: PresetFileKind,
    plans: readonly PresetEntryMovePlan[],
    destinationRelativePath: readonly string[],
    createDestination: boolean,
  ): Promise<MovedPresetEntry[]> {
    const rootDirectory = await this.resolvePresetDirectory(presetType);
    const destinationDirectory = resolvePresetPath(
      rootDirectory,
      destinationRelativePath,
    );
    if (!destinationDirectory) {
      throw new Error('Invalid destination folder path.');
    }

    const resolvedPlans = plans.map((plan) => {
      const sourcePath = resolvePresetPath(
        rootDirectory,
        plan.entry.relativePath,
      );
      if (!sourcePath) {
        throw new Error('Invalid preset item path.');
      }

      const filePath = resolvePresetPath(rootDirectory, plan.relativePath);
      if (!filePath) {
        throw new Error('Invalid destination item path.');
      }

      return {
        entryKind: plan.entry.entryKind,
        relativePath: [...plan.relativePath],
        sourcePath,
        filePath,
        isNoop: plan.isNoop,
      };
    });

    for (const plan of resolvedPlans) {
      await this.ensurePresetEntryKind(plan.sourcePath, plan.entryKind);
    }

    if (createDestination) {
      await mkdir(destinationDirectory, { recursive: true });
    }
    await this.ensurePresetEntryKind(destinationDirectory, 'directory');
    await this.ensureMoveTargetsAvailable(destinationDirectory, resolvedPlans);

    const completedPlans: typeof resolvedPlans = [];
    try {
      for (const plan of resolvedPlans) {
        if (plan.isNoop) {
          continue;
        }
        await this.movePresetEntryWithoutReplacing(plan);
        completedPlans.push(plan);
      }
    } catch (error) {
      let rollbackFailed = false;
      for (const plan of completedPlans.reverse()) {
        try {
          await this.movePresetEntryWithoutReplacing({
            ...plan,
            sourcePath: plan.filePath,
            filePath: plan.sourcePath,
          });
        } catch {
          rollbackFailed = true;
        }
      }
      if (rollbackFailed) {
        throw new Error(
          'Move failed and some preset items could not be restored.',
          { cause: error },
        );
      }
      throw error;
    }

    return resolvedPlans.map((plan) => ({
      presetType,
      entryKind: plan.entryKind,
      relativePath: plan.relativePath,
      sourcePath: plan.sourcePath,
      filePath: plan.filePath,
    }));
  }

  private async moveExistingPresetEntry(
    entry: PresetStorageEntryMove,
    missingMessage: string,
  ): Promise<void> {
    try {
      await this.ensureEntryTargetAvailable(entry);
      if (isCaseOnlyPathChange(entry.sourcePath, entry.filePath)) {
        await this.movePresetEntryWithCaseChange(entry);
      } else {
        await this.movePresetEntryWithoutReplacing(entry);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new Error(missingMessage, { cause: error });
      }
      throw error;
    }
  }

  private async movePresetEntryWithCaseChange(
    entry: PresetStorageEntryMove,
  ): Promise<void> {
    const temporaryPath = path.join(
      path.dirname(entry.sourcePath),
      `.compass-rename-${randomUUID()}`,
    );
    await this.movePresetEntryWithoutReplacing({
      ...entry,
      filePath: temporaryPath,
    });

    try {
      await this.movePresetEntryWithoutReplacing({
        ...entry,
        sourcePath: temporaryPath,
      });
    } catch (error) {
      try {
        await this.movePresetEntryWithoutReplacing({
          ...entry,
          sourcePath: temporaryPath,
          filePath: entry.sourcePath,
        });
      } catch {
        throw new Error(
          'Rename failed and the preset item could not be restored.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async movePresetEntryWithoutReplacing(
    entry: PresetStorageEntryMove,
  ): Promise<void> {
    if (entry.entryKind === 'directory') {
      const reservedDestination = process.platform !== 'win32';
      if (reservedDestination) {
        try {
          await mkdir(entry.filePath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
            throw new Error(
              'An item or folder with that name already exists.',
              { cause: error },
            );
          }
          throw error;
        }
      } else {
        await this.ensurePathDoesNotExist(entry.filePath);
      }

      try {
        await rename(entry.sourcePath, entry.filePath);
      } catch (error) {
        if (reservedDestination) {
          try {
            await rmdir(entry.filePath);
          } catch {
            throw new Error(
              'Move failed and the reserved destination folder could not be removed.',
              { cause: error },
            );
          }
        }
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(
            'An item or folder with that name already exists.',
            { cause: error },
          );
        }
        throw error;
      }
      return;
    }

    try {
      await link(entry.sourcePath, entry.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new Error(
          'An item or folder with that name already exists.',
          { cause: error },
        );
      }
      try {
        await copyFile(
          entry.sourcePath,
          entry.filePath,
          constants.COPYFILE_EXCL,
        );
      } catch (copyError) {
        if ((copyError as NodeJS.ErrnoException).code === 'EEXIST') {
          throw new Error(
            'An item or folder with that name already exists.',
            { cause: copyError },
          );
        }
        throw copyError;
      }
    }

    try {
      await unlink(entry.sourcePath);
    } catch (error) {
      try {
        await unlink(entry.filePath);
      } catch {
        throw new Error(
          'Move failed and the destination file could not be removed.',
          { cause: error },
        );
      }
      throw error;
    }
  }

  private async enqueuePresetEntryMutation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = this.presetEntryMutationQueue.then(operation);
    this.presetEntryMutationQueue = result.then(
      (): void => undefined,
      (): void => undefined,
    );
    return result;
  }

  private async ensureMoveTargetsAvailable(
    destinationDirectory: string,
    plans: readonly {
      filePath: string;
      isNoop: boolean;
    }[],
  ): Promise<void> {
    const occupiedNames = new Set(
      (await readdir(destinationDirectory, {
        encoding: 'utf8',
        withFileTypes: true,
      }) as Dirent<string>[]).map((entry) =>
        entry.name.toLocaleLowerCase('en-US')),
    );
    const hasCollision = plans.some(
      (plan) =>
        !plan.isNoop
        && occupiedNames.has(
          path.basename(plan.filePath).toLocaleLowerCase('en-US'),
        ),
    );
    if (hasCollision) {
      throw new Error('An item or folder with that name already exists.');
    }
  }

  private async ensurePathDoesNotExist(filePath: string): Promise<void> {
    try {
      await lstat(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return;
      }
      throw error;
    }

    throw new Error('An item or folder with that name already exists.');
  }

  private async ensureEntryTargetAvailable(
    entry: PresetStorageEntryMove,
  ): Promise<void> {
    const sourcePath = path.resolve(entry.sourcePath);
    const targetPath = path.resolve(entry.filePath);
    const targetDirectory = path.dirname(targetPath);
    const sourceName = path.dirname(sourcePath) === targetDirectory
      ? path.basename(sourcePath)
      : null;
    await this.ensureDirectoryEntryNameAvailable(
      targetDirectory,
      path.basename(targetPath),
      sourceName,
    );
  }

  private async ensureDirectoryEntryNameAvailable(
    directory: string,
    targetName: string,
    excludedName: string | null = null,
  ): Promise<void> {
    const targetKey = targetName.toLocaleLowerCase('en-US');
    const entries = await readdir(directory, { encoding: 'utf8' });
    const hasCollision = entries.some(
      (name) =>
        name !== excludedName
        && name.toLocaleLowerCase('en-US') === targetKey,
    );
    if (hasCollision) {
      throw new Error('An item or folder with that name already exists.');
    }
  }

  public async ensureAccessible(filePath: string): Promise<void> {
    await access(filePath);
  }

  public async ensurePresetEntryKind(
    filePath: string,
    entryKind: 'file' | 'directory',
  ): Promise<void> {
    const stats = await lstat(filePath);
    const matchesEntryKind = entryKind === 'file'
      ? stats.isFile()
      : stats.isDirectory();
    if (!matchesEntryKind) {
      throw new Error('Preset item type does not match the request.');
    }
  }

  public async readDirectoryEntries(
    directoryPath: string,
  ): Promise<Dirent<string>[]> {
    try {
      return await readdir(directoryPath, {
        encoding: 'utf8',
        withFileTypes: true,
      }) as Dirent<string>[];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  public async readPresetFileByType<K extends PresetFileKind>(
    presetType: K,
    filePath: string,
  ): Promise<ReadPresetEntryResponse<K>> {
    try {
      const text = await readFile(filePath, 'utf8');
      const parsed = parsePresetFileText(text, {
        fileName: filePath,
      });
      if (parsed.ok === false) {
        return {
          status: 'error',
          message: parsed.message,
          filePath,
        };
      }
      if (parsed.preset.presetType !== presetType) {
        return {
          status: 'error',
          message: `Expected a ${presetType} file.`,
          filePath,
        };
      }

      return {
        status: 'loaded',
        filePath,
        payload: parsed.preset as Extract<PresetFile, { presetType: K }>,
        needsSave: parsed.needsSave,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Failed to read file.',
        filePath,
      };
    }
  }
}
