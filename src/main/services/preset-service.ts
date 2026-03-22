import { shell, type BaseWindow } from 'electron';

import type {
  DeletePresetEntryResponse,
  ListPresetBrowserTreeResponse,
  ReadPresetEntryResponse,
  SavePresetFileResponse,
  ShowPresetEntryInFolderResponse,
  ShowPresetsRootInFolderResponse,
} from '../../shared/contracts/ipc/presets';
import { PRESET_FILE_SPECS } from './presets/preset-config';
import { PresetBrowserTreeBuilder } from './presets/preset-browser-tree';
import { PresetDialogs } from './presets/preset-dialogs';
import {
  hasPresetExtension,
  resolvePresetPath,
} from './presets/preset-paths';
import {
  parsePresetEntryRequest,
  parseReadPresetEntryRequest,
  parseSavePresetFileRequest,
} from './presets/preset-requests';
import { PresetStorage } from './presets/preset-storage';

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
};

/** Orchestrates preset validation, dialogs, storage, and shell actions. */
export class PresetService {
  private readonly storage = new PresetStorage();

  private readonly dialogs = new PresetDialogs();

  private readonly browserTreeBuilder = new PresetBrowserTreeBuilder(this.storage);

  public async savePresetFile(
    request: unknown,
    parentWindow?: BaseWindow,
  ): Promise<SavePresetFileResponse> {
    const parsedRequest = parseSavePresetFileRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid preset save request.',
      };
    }

    try {
      const baseDirectory = await this.storage.resolvePresetDirectory(
        parsedRequest.payload.presetType,
      );
      const dialogResult = await this.dialogs.showSavePresetFileDialog(
        parsedRequest,
        baseDirectory,
        parentWindow,
      );
      if (dialogResult.status === 'canceled') {
        return { status: 'canceled' };
      }

      await this.storage.writePresetFile(dialogResult.filePath, parsedRequest.payload);
      return {
        status: 'saved',
        filePath: dialogResult.filePath,
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to save preset file.'),
      };
    }
  }

  public async listPresetBrowserTree(): Promise<ListPresetBrowserTreeResponse> {
    try {
      return {
        status: 'ok',
        tree: await this.browserTreeBuilder.listTree(),
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to list preset browser tree.'),
      };
    }
  }

  public async readPresetEntry(
    request: unknown,
  ): Promise<ReadPresetEntryResponse> {
    const parsedRequest = parseReadPresetEntryRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid preset read request.',
      };
    }

    const rootDirectory = await this.storage.resolvePresetDirectory(parsedRequest.presetType);
    const filePath = resolvePresetPath(rootDirectory, parsedRequest.relativePath);
    if (!filePath) {
      return {
        status: 'error',
        message: 'Invalid preset file path.',
      };
    }

    if (!hasPresetExtension(filePath, PRESET_FILE_SPECS[parsedRequest.presetType].extension)) {
      return {
        status: 'error',
        message: 'Unsupported preset file extension.',
        filePath,
      };
    }

    return this.storage.readPresetFileByType(parsedRequest.presetType, filePath);
  }

  public async showPresetEntryInFolder(
    request: unknown,
  ): Promise<ShowPresetEntryInFolderResponse> {
    const parsedRequest = parsePresetEntryRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid preset entry request.',
      };
    }

    try {
      const rootDirectory = await this.storage.resolvePresetDirectory(parsedRequest.presetType);
      const filePath = resolvePresetPath(rootDirectory, parsedRequest.relativePath);
      if (!filePath) {
        return {
          status: 'error',
          message: 'Invalid preset file path.',
        };
      }

      if (
        parsedRequest.entryKind === 'file'
        && !hasPresetExtension(filePath, PRESET_FILE_SPECS[parsedRequest.presetType].extension)
      ) {
        return {
          status: 'error',
          message: 'Invalid preset file type.',
        };
      }

      await this.storage.ensureAccessible(filePath);
      if (parsedRequest.entryKind === 'directory') {
        const openError = await shell.openPath(filePath);
        if (openError) {
          return {
            status: 'error',
            message: openError,
          };
        }
      } else {
        shell.showItemInFolder(filePath);
      }

      return { status: 'ok' };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to reveal preset file.'),
      };
    }
  }

  public async showPresetsRootInFolder(): Promise<ShowPresetsRootInFolderResponse> {
    try {
      const directory = await this.storage.resolvePresetsRootDirectory();
      const openError = await shell.openPath(directory);
      if (openError) {
        return {
          status: 'error',
          message: openError,
        };
      }

      return { status: 'ok' };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to reveal presets folder.'),
      };
    }
  }

  public async deletePresetEntry(
    request: unknown,
  ): Promise<DeletePresetEntryResponse> {
    const parsedRequest = parsePresetEntryRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid preset entry request.',
      };
    }

    try {
      const rootDirectory = await this.storage.resolvePresetDirectory(parsedRequest.presetType);
      const filePath = resolvePresetPath(rootDirectory, parsedRequest.relativePath);
      if (!filePath) {
        return {
          status: 'error',
          message: 'Invalid preset file path.',
        };
      }

      if (
        parsedRequest.entryKind === 'file'
        && !hasPresetExtension(filePath, PRESET_FILE_SPECS[parsedRequest.presetType].extension)
      ) {
        return {
          status: 'error',
          message: 'Invalid preset file type.',
        };
      }

      await this.storage.ensureAccessible(filePath);
      await shell.trashItem(filePath);
      return { status: 'ok' };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to delete preset entry.'),
      };
    }
  }
}
