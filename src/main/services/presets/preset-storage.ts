import { app } from 'electron';
import type { Dirent } from 'node:fs';
import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { ReadPresetEntryResponse } from '../../../shared/contracts/ipc/presets';
import {
  parsePresetFileText,
  type PresetFile,
  type PresetFileKind,
} from '../../../shared/presets';
import { PRESET_FILE_SPECS, PRESET_ROOT_DIR_NAME } from './preset-config';

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
        mode: 'recover',
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
          message: `Expected a ${presetType} preset file.`,
          filePath,
        };
      }

      return {
        status: 'loaded',
        filePath,
        payload: parsed.preset as Extract<PresetFile, { presetType: K }>,
        warning: parsed.warning,
      };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'Failed to read preset file.',
        filePath,
      };
    }
  }
}
