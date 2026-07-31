import { shell, type BaseWindow } from 'electron';
import { watch, type FSWatcher } from 'node:fs';

import { isDeviceBrowserSystemDirectoryPath } from '../../devices/browser-categories';
import type {
  CreatePresetFolderResponse,
  DeletedPresetEntry,
  DeletePresetEntriesResponse,
  ListPresetBrowserTreeResponse,
  MovePresetEntriesResponse,
  ReadPresetEntryResponse,
  RenameRackFileResponse,
  RenamePresetFileResponse,
  RenamePresetFolderResponse,
  SaveRackFileResponse,
  SavePresetFileResponse,
  ShowPresetEntryInFolderResponse,
} from '../../shared/contracts/ipc/presets';
import { preparePresetEntryMove } from '../../shared/preset-entry-move';
import { normalizePresetEntrySelection } from '../../shared/preset-entry-selection';
import { PRESET_FILE_SPECS } from './presets/preset-config';
import { PresetBrowserTreeBuilder } from './presets/preset-browser-tree';
import { PresetDialogs } from './presets/preset-dialogs';
import {
  hasPresetExtension,
  resolvePresetPath,
} from './presets/preset-paths';
import {
  parseCreatePresetFolderRequest,
  parseDeletePresetEntriesRequest,
  parseMovePresetEntriesRequest,
  parsePresetEntryRequest,
  parseReadPresetEntryRequest,
  parseSaveRackFileRequest,
  parseRenameRackFileRequest,
  parseRenamePresetFileRequest,
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

      await this.storage.writePresetFile(dialogResult.filePath, parsedRequest.payload);
      await this.dialogs.rememberSaveDirectory(
        parsedRequest.payload.presetType,
        dialogResult.filePath,
      );
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
      const result = await this.browserTreeBuilder.listTree();
      return {
        status: 'ok',
        ...result,
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to list presets.'),
      };
    }
  }

  public async renamePresetFile(
    request: unknown,
  ): Promise<RenamePresetFileResponse> {
    const parsedRequest = parseRenamePresetFileRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid preset file rename request.',
      };
    }

    const spec = PRESET_FILE_SPECS[parsedRequest.presetType];
    const currentFileName = parsedRequest.relativePath[parsedRequest.relativePath.length - 1] ?? '';
    if (!hasPresetExtension(currentFileName, spec.extension)) {
      return {
        status: 'error',
        message: 'Unsupported preset file extension.',
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

      const renamedPath = await this.storage.renamePresetFile(
        filePath,
        parsedRequest.fileName,
        spec.extension,
      );
      return {
        status: 'renamed',
        sourcePath: filePath,
        filePath: renamedPath,
        relativePath: [
          ...parsedRequest.relativePath.slice(0, -1),
          renamedPath.split(/[\\/]/).pop() ?? currentFileName,
        ],
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to rename preset file.'),
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
    if (
      parsedRequest.presetType === 'device'
      && isDeviceBrowserSystemDirectoryPath([
        ...parsedRequest.relativePath,
        parsedRequest.folderName.trim(),
      ])
    ) {
      return {
        status: 'error',
        message: 'Built-in device folder names are reserved.',
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
    if (
      parsedRequest.presetType === 'device'
      && isDeviceBrowserSystemDirectoryPath(parsedRequest.relativePath)
    ) {
      return {
        status: 'error',
        message: 'Built-in device folders cannot be renamed.',
      };
    }
    if (
      parsedRequest.presetType === 'device'
      && isDeviceBrowserSystemDirectoryPath([
        ...parsedRequest.relativePath.slice(0, -1),
        parsedRequest.folderName.trim(),
      ])
    ) {
      return {
        status: 'error',
        message: 'Built-in device folder names are reserved.',
      };
    }

    try {
      const renamedFolder = await this.storage.renamePresetFolder(
        parsedRequest.presetType,
        parsedRequest.relativePath,
        parsedRequest.folderName,
      );
      return {
        status: 'ok',
        ...renamedFolder,
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

  public async deletePresetEntries(
    request: unknown,
  ): Promise<DeletePresetEntriesResponse> {
    const parsedRequest = parseDeletePresetEntriesRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid preset items request.',
      };
    }
    if (parsedRequest.entries.some((entry) => entry.relativePath.length === 0)) {
      return {
        status: 'error',
        message: 'Preset root folders cannot be deleted.',
      };
    }

    try {
      const normalizedEntries = normalizePresetEntrySelection(parsedRequest.entries);
      if (
        normalizedEntries.some(
          (entry) =>
            entry.entryKind === 'directory'
            && entry.presetType === 'device'
            && isDeviceBrowserSystemDirectoryPath(entry.relativePath),
        )
      ) {
        return {
          status: 'error',
          message: 'Built-in device folders cannot be deleted.',
        };
      }

      const entriesToDelete: DeletedPresetEntry[] = [];
      for (const entry of normalizedEntries) {
        const rootDirectory = await this.storage.resolvePresetDirectory(entry.presetType);
        const filePath = resolvePresetPath(rootDirectory, entry.relativePath);
        if (!filePath) {
          return {
            status: 'error',
            message: 'Invalid file path.',
          };
        }

        if (
          entry.entryKind === 'file'
          && !hasPresetExtension(filePath, PRESET_FILE_SPECS[entry.presetType].extension)
        ) {
          return {
            status: 'error',
            message: 'Invalid file type.',
          };
        }

        entriesToDelete.push({
          entryKind: entry.entryKind,
          filePath,
          presetType: entry.presetType,
          relativePath: [...entry.relativePath],
        });
      }

      await this.storage.trashPresetEntries(entriesToDelete);
      return { status: 'ok', entries: entriesToDelete };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to delete preset item.'),
      };
    }
  }

  public async movePresetEntries(
    request: unknown,
  ): Promise<MovePresetEntriesResponse> {
    const parsedRequest = parseMovePresetEntriesRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid preset move request.',
      };
    }

    try {
      const occupiedPaths = await this.browserTreeBuilder.listOccupiedPaths(
        parsedRequest.destination.presetType,
      );
      const movePlan = preparePresetEntryMove(
        parsedRequest.entries,
        parsedRequest.destination,
        occupiedPaths,
      );
      if (movePlan.status === 'error') {
        return movePlan;
      }

      for (const { entry } of movePlan.plans) {
        if (
          entry.entryKind === 'file'
          && !hasPresetExtension(
            entry.relativePath[entry.relativePath.length - 1] ?? '',
            PRESET_FILE_SPECS[movePlan.presetType].extension,
          )
        ) {
          return {
            status: 'error',
            message: 'Invalid file type.',
          };
        }
      }

      return {
        status: 'ok',
        entries: await this.storage.movePresetEntries(
          movePlan.presetType,
          movePlan.plans,
          movePlan.destinationRelativePath,
          movePlan.createDestination,
        ),
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to move preset items.'),
      };
    }
  }
}
