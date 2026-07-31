import {
  app,
  dialog,
  type BaseWindow,
  type SaveDialogOptions,
} from 'electron';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import type {
  SavePresetFileRequest,
} from '../../../shared/contracts/ipc/presets';
import { type PresetFileKind } from '../../../shared/presets';
import { PRESET_FILE_SPECS } from './preset-config';
import {
  ensurePresetExtension,
  resolvePresetSaveDirectory,
  sanitizeFileStem,
} from './preset-paths';

const PRESET_DIALOG_STATE_SCHEMA_VERSION = 1 as const;
const PRESET_DIALOG_STATE_FILE_NAME = 'preset-dialog-state.json';

interface PresetDialogState {
  schemaVersion: typeof PRESET_DIALOG_STATE_SCHEMA_VERSION;
  lastSaveDirectoryByPresetType: Partial<Record<PresetFileKind, string>>;
}

const createEmptyPresetDialogState = (): PresetDialogState => ({
  schemaVersion: PRESET_DIALOG_STATE_SCHEMA_VERSION,
  lastSaveDirectoryByPresetType: {},
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const parsePresetDialogState = (value: unknown): PresetDialogState => {
  if (
    !isRecord(value)
    || value.schemaVersion !== PRESET_DIALOG_STATE_SCHEMA_VERSION
    || !isRecord(value.lastSaveDirectoryByPresetType)
  ) {
    return createEmptyPresetDialogState();
  }

  const lastSaveDirectoryByPresetType: Partial<Record<PresetFileKind, string>> = {};
  for (const presetType of ['device', 'group', 'rack'] as const) {
    const directory = value.lastSaveDirectoryByPresetType[presetType];
    if (typeof directory === 'string' && path.isAbsolute(directory)) {
      lastSaveDirectoryByPresetType[presetType] = path.resolve(directory);
    }
  }

  return {
    schemaVersion: PRESET_DIALOG_STATE_SCHEMA_VERSION,
    lastSaveDirectoryByPresetType,
  };
};

const resolveDialogOptions = (
  presetType: PresetFileKind,
  defaultPath: string,
) => {
  const spec = PRESET_FILE_SPECS[presetType];
  const extension = spec.extension.slice(1);
  return {
    defaultPath,
    filters: [
      { name: spec.filterName, extensions: [extension] },
      { name: 'All Files', extensions: ['*'] },
    ],
  };
};

type SelectedFilePath =
  | { status: 'selected'; filePath: string }
  | { status: 'canceled' };

/** Shows native open/save preset dialogs and returns the selected file path. */
export class PresetDialogs {
  private statePromise: Promise<PresetDialogState> | null = null;

  private stateWriteQueue: Promise<void> = Promise.resolve();

  public async showSavePresetFileDialog(
    request: SavePresetFileRequest,
    baseDirectory: string,
    parentWindow?: BaseWindow,
  ): Promise<SelectedFilePath> {
    const spec = PRESET_FILE_SPECS[request.payload.presetType];
    const fallbackDirectory = resolvePresetSaveDirectory(baseDirectory, request);
    await mkdir(fallbackDirectory, { recursive: true });
    const directory = await this.resolveInitialSaveDirectory(
      request.payload.presetType,
      fallbackDirectory,
    );
    const suggestedFileName = `${sanitizeFileStem(
      request.suggestedName,
      spec.defaultName,
    )}${spec.extension}`;
    const dialogOptions: SaveDialogOptions = {
      ...resolveDialogOptions(
        request.payload.presetType,
        path.join(directory, suggestedFileName),
      ),
      buttonLabel: 'Save',
      properties: ['createDirectory'],
      title: `Save ${spec.defaultName}`,
    };

    const result = parentWindow
      ? await dialog.showSaveDialog(parentWindow, dialogOptions)
      : await dialog.showSaveDialog(dialogOptions);
    if (result.canceled || !result.filePath) {
      return { status: 'canceled' };
    }

    return {
      status: 'selected',
      filePath: ensurePresetExtension(result.filePath, spec.extension),
    };
  }

  public async rememberSaveDirectory(
    presetType: PresetFileKind,
    filePath: string,
  ): Promise<void> {
    const directory = path.resolve(path.dirname(filePath));
    this.stateWriteQueue = this.stateWriteQueue.then(async () => {
      const state = await this.loadState();
      const nextState: PresetDialogState = {
        ...state,
        lastSaveDirectoryByPresetType: {
          ...state.lastSaveDirectoryByPresetType,
          [presetType]: directory,
        },
      };
      this.statePromise = Promise.resolve(nextState);

      try {
        await this.writeState(nextState);
      } catch (error) {
        console.error('Failed to persist preset dialog state.', error);
      }
    });

    await this.stateWriteQueue;
  }

  private async resolveInitialSaveDirectory(
    presetType: PresetFileKind,
    fallbackDirectory: string,
  ): Promise<string> {
    const state = await this.loadState();
    const rememberedDirectory = state.lastSaveDirectoryByPresetType[presetType];
    if (!rememberedDirectory) {
      return fallbackDirectory;
    }

    try {
      const directoryStat = await stat(rememberedDirectory);
      return directoryStat.isDirectory() ? rememberedDirectory : fallbackDirectory;
    } catch {
      return fallbackDirectory;
    }
  }

  private loadState(): Promise<PresetDialogState> {
    this.statePromise ??= this.readState();
    return this.statePromise;
  }

  private async readState(): Promise<PresetDialogState> {
    try {
      const content = await readFile(this.resolveStateFilePath(), 'utf8');
      return parsePresetDialogState(JSON.parse(content) as unknown);
    } catch {
      return createEmptyPresetDialogState();
    }
  }

  private async writeState(state: PresetDialogState): Promise<void> {
    const stateFilePath = this.resolveStateFilePath();
    const temporaryFilePath = `${stateFilePath}.${process.pid}.${randomUUID()}.tmp`;

    try {
      await writeFile(
        temporaryFilePath,
        `${JSON.stringify(state, null, 2)}\n`,
        { encoding: 'utf8', flush: true, mode: 0o600 },
      );
      await rename(temporaryFilePath, stateFilePath);
    } catch (error) {
      try {
        await unlink(temporaryFilePath);
      } catch {
        // The temporary file may not exist if writing failed before creation.
      }
      throw error;
    }
  }

  private resolveStateFilePath(): string {
    return path.join(app.getPath('userData'), PRESET_DIALOG_STATE_FILE_NAME);
  }
}
