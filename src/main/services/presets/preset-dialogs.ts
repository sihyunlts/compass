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

import { RENDERER_DEVICE_KINDS } from '../../../devices/schema-registry';
import type { RendererDeviceKind } from '../../../devices/types';
import type {
  SavePresetFileRequest,
} from '../../../shared/contracts/ipc/presets';
import type { PresetFileKind } from '../../../shared/presets';
import { PRESET_FILE_SPECS } from './preset-config';
import {
  ensurePresetExtension,
  resolvePresetSaveDirectory,
  sanitizeFileStem,
} from './preset-paths';

const PRESET_DIALOG_STATE_SCHEMA_VERSION = 1 as const;
const PRESET_DIALOG_STATE_FILE_NAME = 'preset-dialog-state.json';

interface LastSaveDirectoryByContext {
  device: Partial<Record<RendererDeviceKind, string>>;
  group?: string;
  rack?: string;
}

interface PresetDialogState {
  schemaVersion: typeof PRESET_DIALOG_STATE_SCHEMA_VERSION;
  lastSaveDirectoryByContext: LastSaveDirectoryByContext;
}

const createEmptyPresetDialogState = (): PresetDialogState => ({
  schemaVersion: PRESET_DIALOG_STATE_SCHEMA_VERSION,
  lastSaveDirectoryByContext: {
    device: {},
  },
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const assignNonDeviceSaveDirectories = (
  target: LastSaveDirectoryByContext,
  source: Record<string, unknown>,
): void => {
  for (const presetType of ['group', 'rack'] as const) {
    const directory = source[presetType];
    if (typeof directory === 'string' && path.isAbsolute(directory)) {
      target[presetType] = path.resolve(directory);
    }
  }
};

const parsePresetDialogState = (value: unknown): PresetDialogState => {
  if (!isRecord(value)) {
    return createEmptyPresetDialogState();
  }

  if (
    value.schemaVersion !== PRESET_DIALOG_STATE_SCHEMA_VERSION
    || !isRecord(value.lastSaveDirectoryByContext)
    || !isRecord(value.lastSaveDirectoryByContext.device)
  ) {
    return createEmptyPresetDialogState();
  }

  const device: Partial<Record<RendererDeviceKind, string>> = {};
  for (const deviceKind of RENDERER_DEVICE_KINDS) {
    const directory = value.lastSaveDirectoryByContext.device[deviceKind];
    if (typeof directory === 'string' && path.isAbsolute(directory)) {
      device[deviceKind] = path.resolve(directory);
    }
  }

  const lastSaveDirectoryByContext: LastSaveDirectoryByContext = { device };
  assignNonDeviceSaveDirectories(
    lastSaveDirectoryByContext,
    value.lastSaveDirectoryByContext,
  );

  return {
    schemaVersion: PRESET_DIALOG_STATE_SCHEMA_VERSION,
    lastSaveDirectoryByContext,
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
      request,
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
    request: SavePresetFileRequest,
    filePath: string,
  ): Promise<void> {
    const directory = path.resolve(path.dirname(filePath));
    this.stateWriteQueue = this.stateWriteQueue.then(async () => {
      const state = await this.loadState();
      const nextState: PresetDialogState = {
        ...state,
        lastSaveDirectoryByContext: request.payload.presetType === 'device'
          ? {
              ...state.lastSaveDirectoryByContext,
              device: {
                ...state.lastSaveDirectoryByContext.device,
                [request.payload.device.kind]: directory,
              },
            }
          : {
              ...state.lastSaveDirectoryByContext,
              [request.payload.presetType]: directory,
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
    request: SavePresetFileRequest,
    fallbackDirectory: string,
  ): Promise<string> {
    const state = await this.loadState();
    const rememberedDirectory = request.payload.presetType === 'device'
      ? state.lastSaveDirectoryByContext.device[request.payload.device.kind]
      : state.lastSaveDirectoryByContext[request.payload.presetType];
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
