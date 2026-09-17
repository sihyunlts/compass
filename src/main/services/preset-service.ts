import { PresetRepository } from '../../shared/preset/repository';
import { NativePresetBackend } from './presets/native-preset-backend';
import { shell, type BaseWindow } from 'electron';
import { watch, type FSWatcher } from 'node:fs';

import type {
  CopyPresetEntriesResponse,
  CreatePresetFolderResponse,
  DeletePresetEntriesResponse,
  ListPresetBrowserTreeResponse,
  MovePresetEntriesResponse,
  ReadPresetEntryResponse,
  RenamePresetFileResponse,
  RenamePresetFolderResponse,
  SaveRackFileResponse,
  SavePresetFileResponse,
  ShowPresetEntryInFolderResponse,
  UpdatePresetFileInfoResponse,
  UpdateRackFileInfoResponse,
} from '../../shared/contracts/ipc/presets';
import type { AuthoredMetadata } from '../../shared/model';
import { withPresetAuthoredMetadata, type PresetFile, type PresetFileKind } from '../../shared/preset/file';

import { PRESET_FILE_SPECS } from './presets/preset-config';

import { PresetDialogs } from './presets/preset-dialogs';
import { hasPresetExtension } from '../../shared/preset/paths';
import { resolvePresetPath } from './presets/preset-paths';
import {
  parsePresetEntryRequest,
  parseSaveRackFileRequest,
  parseSavePresetFileRequest,
  parseUpdateRackFileInfoRequest,
} from '../../shared/preset/requests';
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

  private readonly backend = new NativePresetBackend(this.storage);

  private readonly repository = new PresetRepository(this.backend);

  private browserTreeWatcher: FSWatcher | null = null;

  private browserTreeChangeTimer: ReturnType<typeof setTimeout> | null = null;

  public async startWatchingBrowserTree(onChange: () => void): Promise<void> {
    this.stopWatchingBrowserTree();

    try {
      const presetsRootDirectory = await this.storage.resolvePresetsRootDirectory();
      this.browserTreeWatcher = watch(
        presetsRootDirectory,
        { recursive: true, persistent: false },
        () => {
          if (this.browserTreeChangeTimer) {
            clearTimeout(this.browserTreeChangeTimer);
          }
          this.browserTreeChangeTimer = setTimeout(() => {
            this.browserTreeChangeTimer = null;
            onChange();
          }, 75);
        },
      );
      this.browserTreeWatcher.on('error', (error) => {
        console.error('Preset browser file watcher failed.', error);
        this.stopWatchingBrowserTree();
      });
    } catch (error) {
      console.error('Failed to start preset browser file watcher.', error);
      this.stopWatchingBrowserTree();
    }
  }

  public stopWatchingBrowserTree(): void {
    if (this.browserTreeChangeTimer) {
      clearTimeout(this.browserTreeChangeTimer);
      this.browserTreeChangeTimer = null;
    }
    this.browserTreeWatcher?.close();
    this.browserTreeWatcher = null;
  }

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

      const savedPath = await this.saveAtPath(dialogResult.filePath, parsedRequest.payload);
      await this.dialogs.rememberSaveDirectory(
        parsedRequest,
        dialogResult.filePath,
      );
      return {
        status: 'saved',
        filePath: savedPath,
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
      const savedPath = await this.saveAtPath(parsedRequest.filePath, parsedRequest.payload);
      return {
        status: 'saved',
        filePath: savedPath,
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to save rack file.'),
        filePath: parsedRequest.filePath,
      };
    }
  }

  public async updateRackFileInfo(
    request: unknown,
  ): Promise<UpdateRackFileInfoResponse> {
    const parsedRequest = parseUpdateRackFileInfoRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid rack info update request.',
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
      const updated = await this.updatePresetInfoAtPath(
        'rack',
        parsedRequest.filePath,
        parsedRequest.fileName,
        parsedRequest.metadata,
      );
      return {
        status: 'updated',
        ...updated,
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to update rack info.'),
        filePath: parsedRequest.filePath,
      };
    }
  }

  public async listPresetBrowserTree(): Promise<ListPresetBrowserTreeResponse> {
    return this.repository.listPresetBrowserTree();
  }

  public async renamePresetFile(
    request: unknown,
  ): Promise<RenamePresetFileResponse> {
    return this.repository.renamePresetFile(request);
  }

  public async updatePresetFileInfo(
    request: unknown,
  ): Promise<UpdatePresetFileInfoResponse> {
    return this.repository.updatePresetFileInfo(request);
  }

  private async saveAtPath(filePath: string, payload: PresetFile): Promise<string> {
    const entry = await this.backend.entryAtPath(payload.presetType, filePath);
    if (!entry) {
      await this.storage.writePresetFile(filePath, payload);
      return filePath;
    }
    const result = await this.repository.savePresetAt(entry, payload, 'overwrite');
    if (result.status !== 'saved') {
      throw new Error(result.status === 'error' ? result.message : 'Preset could not be saved at that location.');
    }
    return result.filePath;
  }

  private async updatePresetInfoAtPath(
    presetType: PresetFileKind,
    filePath: string,
    fileName: string,
    metadata: AuthoredMetadata | undefined,
  ): Promise<{ filePath: string; savedAtIso: string }> {
    const entry = await this.backend.entryAtPath(presetType, filePath);
    if (entry) {
      const result = await this.repository.updatePresetFileInfo({ ...entry, source: 'user', fileName, metadata });
      if (result.status === 'error') throw new Error(result.message);
      return { filePath: result.filePath, savedAtIso: result.savedAtIso };
    }
    const savedAtIso = new Date().toISOString();
    const updatedPath = await this.storage.updatePresetFile(
      presetType,
      filePath,
      fileName,
      PRESET_FILE_SPECS[presetType].extension,
      (payload) => withPresetAuthoredMetadata(
        payload,
        metadata,
        savedAtIso,
      ),
    );
    return {
      filePath: updatedPath,
      savedAtIso,
    };
  }

  public async createPresetFolder(
    request: unknown,
  ): Promise<CreatePresetFolderResponse> {
    return this.repository.createPresetFolder(request);
  }

  public async renamePresetFolder(
    request: unknown,
  ): Promise<RenamePresetFolderResponse> {
    return this.repository.renamePresetFolder(request);
  }

  public async readPresetEntry(
    request: unknown,
  ): Promise<ReadPresetEntryResponse> {
    return this.repository.readPresetEntry(request);
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

  public async deletePresetEntries(
    request: unknown,
  ): Promise<DeletePresetEntriesResponse> {
    return this.repository.deletePresetEntries(request);
  }

  public async movePresetEntries(
    request: unknown,
  ): Promise<MovePresetEntriesResponse> {
    return this.repository.movePresetEntries(request);
  }

  public async copyPresetEntries(
    request: unknown,
  ): Promise<CopyPresetEntriesResponse> {
    return this.repository.copyPresetEntries(request);
  }

}
