import { app } from 'electron';
import type { Dirent } from 'node:fs';
import { access, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ReadPresetEntryResponse } from '../../../shared/contracts/ipc/presets';
import {
  parsePresetFileText,
  type PresetFile,
  type PresetFileKind,
} from '../../../shared/presets';
import { PRESET_FILE_SPECS, PRESET_ROOT_DIR_NAME } from './preset-config';
import {
  isValidPresetPathSegment,
  normalizePresetPathSegment,
  resolvePresetPath,
} from './preset-paths';

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

/** Reads and writes preset files under the app's preset root. */
export class PresetStorage {
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
    return directory;
  }

  public async writePresetFile(filePath: string, payload: PresetFile): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(serializePresetFile(payload), null, 2)}\n`, 'utf8');
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

    try {
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

    return relativePath;
  }

  public async renamePresetFolder(
    presetType: PresetFileKind,
    relativePath: readonly string[],
    folderName: string,
  ): Promise<string[]> {
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
      return nextRelativePath;
    }

    const targetDirectory = resolvePresetPath(rootDirectory, nextRelativePath);
    if (!targetDirectory) {
      throw new Error('Invalid preset folder path.');
    }

    try {
      await access(targetDirectory);
      throw new Error('An item or folder with that name already exists.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        if (error instanceof Error && error.message === 'An item or folder with that name already exists.') {
          throw error;
        }
        throw error;
      }
    }

    try {
      await rename(sourceDirectory, targetDirectory);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        throw new Error('An item or folder with that name already exists.', { cause: error });
      }
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new Error('Folder does not exist.', { cause: error });
      }

      throw error;
    }

    return nextRelativePath;
  }

  public async ensureAccessible(filePath: string): Promise<void> {
    await access(filePath);
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
