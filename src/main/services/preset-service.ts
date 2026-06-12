import { shell, type BaseWindow } from 'electron';

import type {
  CreatePresetFolderResponse,
  DeletePresetEntryResponse,
  ListPresetBrowserTreeResponse,
  ReadPresetEntryResponse,
  RenameRackFileResponse,
  RenamePresetFolderResponse,
  SaveRackFileResponse,
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
  parseCreatePresetFolderRequest,
  parsePresetEntryRequest,
  parseReadPresetEntryRequest,
  parseSaveRackFileRequest,
  parseRenameRackFileRequest,
  parseRenamePresetFolderRequest,
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
        message: 'Invalid save request.',
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
        message: toErrorMessage(error, 'Failed to save file.'),
      };
    }
  }

  public async saveRackFile(
    request: unknown,
  ): Promise<SaveRackFileResponse> {
    const parsedRequest = parseSaveRackFileRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid rack save request.',
      };
    }

    if (!hasPresetExtension(parsedRequest.filePath, PRESET_FILE_SPECS.rack.extension)) {
      return {
        status: 'error',
        message: 'Unsupported rack file extension.',
        filePath: parsedRequest.filePath,
      };
    }

    try {
      await this.storage.writePresetFile(parsedRequest.filePath, parsedRequest.payload);
      return {
        status: 'saved',
        filePath: parsedRequest.filePath,
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to save rack file.'),
        filePath: parsedRequest.filePath,
      };
    }
  }

  public async renameRackFile(
    request: unknown,
  ): Promise<RenameRackFileResponse> {
    const parsedRequest = parseRenameRackFileRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid rack rename request.',
      };
    }

    if (!hasPresetExtension(parsedRequest.filePath, PRESET_FILE_SPECS.rack.extension)) {
      return {
        status: 'error',
        message: 'Unsupported rack file extension.',
        filePath: parsedRequest.filePath,
      };
    }

    try {
      return {
        status: 'renamed',
        filePath: await this.storage.renamePresetFile(
          parsedRequest.filePath,
          parsedRequest.fileName,
          PRESET_FILE_SPECS.rack.extension,
        ),
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to rename rack file.'),
        filePath: parsedRequest.filePath,
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
        message: toErrorMessage(error, 'Failed to list presets.'),
      };
    }
  }

  public async createPresetFolder(
    request: unknown,
  ): Promise<CreatePresetFolderResponse> {
    const parsedRequest = parseCreatePresetFolderRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid folder request.',
      };
    }

    try {
      return {
        status: 'ok',
        relativePath: await this.storage.createPresetFolder(
          parsedRequest.presetType,
          parsedRequest.relativePath,
          parsedRequest.folderName,
        ),
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to create folder.'),
      };
    }
  }

  public async renamePresetFolder(
    request: unknown,
  ): Promise<RenamePresetFolderResponse> {
    const parsedRequest = parseRenamePresetFolderRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid folder request.',
      };
    }

    try {
      return {
        status: 'ok',
        relativePath: await this.storage.renamePresetFolder(
          parsedRequest.presetType,
          parsedRequest.relativePath,
          parsedRequest.folderName,
        ),
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to rename folder.'),
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
        message: 'Invalid file read request.',
      };
    }

    const rootDirectory = await this.storage.resolvePresetDirectory(parsedRequest.presetType);
    const filePath = resolvePresetPath(rootDirectory, parsedRequest.relativePath);
    if (!filePath) {
      return {
        status: 'error',
        message: 'Invalid file path.',
      };
    }

    if (!hasPresetExtension(filePath, PRESET_FILE_SPECS[parsedRequest.presetType].extension)) {
      return {
        status: 'error',
        message: 'Unsupported file extension.',
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
        message: 'Invalid preset item request.',
      };
    }

    try {
      const rootDirectory = await this.storage.resolvePresetDirectory(parsedRequest.presetType);
      const filePath = resolvePresetPath(rootDirectory, parsedRequest.relativePath);
      if (!filePath) {
        return {
          status: 'error',
          message: 'Invalid file path.',
        };
      }

      if (
        parsedRequest.entryKind === 'file'
        && !hasPresetExtension(filePath, PRESET_FILE_SPECS[parsedRequest.presetType].extension)
      ) {
        return {
          status: 'error',
          message: 'Invalid file type.',
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
        message: toErrorMessage(error, 'Failed to reveal file.'),
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
        message: 'Invalid preset item request.',
      };
    }

    try {
      const rootDirectory = await this.storage.resolvePresetDirectory(parsedRequest.presetType);
      const filePath = resolvePresetPath(rootDirectory, parsedRequest.relativePath);
      if (!filePath) {
        return {
          status: 'error',
          message: 'Invalid file path.',
        };
      }

      if (
        parsedRequest.entryKind === 'file'
        && !hasPresetExtension(filePath, PRESET_FILE_SPECS[parsedRequest.presetType].extension)
      ) {
        return {
          status: 'error',
          message: 'Invalid file type.',
        };
      }

      await this.storage.ensureAccessible(filePath);
      await shell.trashItem(filePath);
      return { status: 'ok' };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to delete preset item.'),
      };
    }
  }
}
