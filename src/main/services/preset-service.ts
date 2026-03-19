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
  isPresetFileKind,
  parsePresetFile,
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

const parseSavePresetFileRequest = (
  value: unknown,
): SavePresetFileRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || typeof (value as { suggestedName?: unknown }).suggestedName !== 'string'
  ) {
    return null;
  }

  const payload = parsePresetFile((value as { payload?: unknown }).payload, {
    mode: 'strict',
  });
  if (!payload) {
    return null;
  }

  return {
    suggestedName: (value as { suggestedName: string }).suggestedName,
    payload: payload.preset,
  };
};

const parseOpenPresetFileRequest = (
  value: unknown,
): OpenPresetFileRequest | null =>
  typeof value === 'object'
  && value !== null
  && isPresetFileKind((value as { presetType?: unknown }).presetType)
    ? { presetType: (value as { presetType: PresetFileKind }).presetType }
    : null;

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
      const presetType = parsedRequest.payload.presetType;
      const spec = PRESET_FILE_SPECS[presetType];
      const directory = await this.resolvePresetDirectory(presetType);
      const suggestedFileName = `${sanitizeFileStem(
        parsedRequest.suggestedName,
        spec.defaultName,
      )}${spec.extension}`;
      const dialogOptions: SaveDialogOptions = {
        ...resolveDialogOptions(
          presetType,
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
      await writeFile(
        filePath,
        `${JSON.stringify(parsedRequest.payload, null, 2)}\n`,
        'utf8',
      );
      return {
        status: 'saved',
        filePath,
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to save preset file.'),
      };
    }
  }

  public async openPresetFile(
    request: unknown,
    parentWindow?: BaseWindow,
  ): Promise<OpenPresetFileResponse> {
    const parsedRequest = parseOpenPresetFileRequest(request);
    if (!parsedRequest) {
      return {
        status: 'error',
        message: 'Invalid preset open request.',
      };
    }

    try {
      const spec = PRESET_FILE_SPECS[parsedRequest.presetType];
      const directory = await this.resolvePresetDirectory(parsedRequest.presetType);
      const dialogOptions: OpenDialogOptions = {
        ...resolveDialogOptions(parsedRequest.presetType, directory),
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
      if (parsed.preset.presetType !== parsedRequest.presetType) {
        return {
          status: 'error',
          message: `Expected a ${parsedRequest.presetType} preset file.`,
          filePath,
        };
      }

      return {
        status: 'opened',
        filePath,
        payload: parsed.preset,
        warning: parsed.warning,
      };
    } catch (error) {
      return {
        status: 'error',
        message: toErrorMessage(error, 'Failed to read preset file.'),
      };
    }
  }
}
