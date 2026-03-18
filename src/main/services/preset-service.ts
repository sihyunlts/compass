import {
  app,
  dialog,
  type BaseWindow,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  OpenPresetFileRequest,
  OpenPresetFileResponse,
  SavePresetFileRequest,
  SavePresetFileResponse,
} from '../../shared/contracts/ipc/presets';
import {
  isPresetFile,
  parsePresetFileText,
  PRESET_FILE_EXTENSIONS,
  type PresetFileKind,
} from '../../shared/presets';

const PRESET_ROOT_DIR_NAME = 'presets';

const PRESET_FILE_SPECS = {
  device: {
    directory: 'devices',
    extension: PRESET_FILE_EXTENSIONS.device,
    filterName: 'Compass Device Presets',
    defaultName: 'Device Preset',
  },
  group: {
    directory: 'groups',
    extension: PRESET_FILE_EXTENSIONS.group,
    filterName: 'Compass Group Presets',
    defaultName: 'Group Preset',
  },
  rack: {
    directory: 'racks',
    extension: PRESET_FILE_EXTENSIONS.rack,
    filterName: 'Compass Rack Presets',
    defaultName: 'Rack Preset',
  },
} as const satisfies Record<
  PresetFileKind,
  {
    directory: string;
    extension: string;
    filterName: string;
    defaultName: string;
  }
>;

const sanitizeFileStem = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  const sanitized = trimmed
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || fallback;
};

const hasPresetExtension = (
  filePath: string,
  extension: string,
): boolean => filePath.toLowerCase().endsWith(extension);

const ensurePresetExtension = (
  filePath: string,
  extension: string,
): string => {
  if (hasPresetExtension(filePath, extension)) {
    return filePath;
  }

  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
};

const toErrorMessage = (error: unknown, fallback: string): string => {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  return fallback;
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

/** Handles preset file dialogs and JSON serialization for preset payloads. */
export class PresetService {
  private async resolvePresetDirectory(
    presetType: PresetFileKind,
  ): Promise<string> {
    const spec = PRESET_FILE_SPECS[presetType];
    const directory = path.join(
      app.getPath('userData'),
      PRESET_ROOT_DIR_NAME,
      spec.directory,
    );
    await mkdir(directory, { recursive: true });
    return directory;
  }

  public async savePresetFile(
    request: SavePresetFileRequest,
    parentWindow?: BaseWindow,
  ): Promise<SavePresetFileResponse> {
    if (!isPresetFile(request.payload) || request.payload.presetType !== request.presetType) {
      return {
        status: 'error',
        message: 'Preset payload does not match the selected preset type.',
      };
    }

    const spec = PRESET_FILE_SPECS[request.presetType];
    const directory = await this.resolvePresetDirectory(request.presetType);
    const suggestedFileName = `${sanitizeFileStem(
      request.suggestedName,
      spec.defaultName,
    )}${spec.extension}`;
    const dialogOptions: SaveDialogOptions = {
      ...resolveDialogOptions(
        request.presetType,
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

    const filePath = ensurePresetExtension(result.filePath, spec.extension);

    try {
      await writeFile(
        filePath,
        `${JSON.stringify(request.payload, null, 2)}\n`,
        'utf8',
      );
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to save preset file.'),
        filePath,
      };
    }

    return {
      status: 'saved',
      filePath,
    };
  }

  public async openPresetFile(
    request: OpenPresetFileRequest,
    parentWindow?: BaseWindow,
  ): Promise<OpenPresetFileResponse> {
    const spec = PRESET_FILE_SPECS[request.presetType];
    const directory = await this.resolvePresetDirectory(request.presetType);
    const dialogOptions: OpenDialogOptions = {
      ...resolveDialogOptions(request.presetType, directory),
      buttonLabel: 'Open',
      properties: ['openFile'],
      title: `Open ${spec.defaultName}`,
    };

    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    const filePath = result.filePaths[0] ?? '';
    if (result.canceled || !filePath) {
      return { status: 'canceled' };
    }

    if (!hasPresetExtension(filePath, spec.extension)) {
      return {
        status: 'error',
        message: `Expected a ${spec.extension} file.`,
        filePath,
      };
    }

    let text: string;
    try {
      text = await readFile(filePath, 'utf8');
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to read preset file.'),
        filePath,
      };
    }

    const parsed = parsePresetFileText(text, {
      fileName: filePath,
      expectedType: request.presetType,
    });
    if (parsed.ok === false) {
      return {
        status: 'error',
        message: parsed.message,
        filePath,
      };
    }

    return {
      status: 'opened',
      filePath,
      payload: parsed.preset,
    };
  }
}
