import {
  dialog,
  type BaseWindow,
  type OpenDialogOptions,
  type SaveDialogOptions,
} from 'electron';
import path from 'node:path';

import type {
  OpenPresetFileRequest,
  SavePresetFileRequest,
} from '../../../shared/contracts/ipc/presets';
import { type PresetFileKind } from '../../../shared/presets';
import { PRESET_FILE_SPECS } from './preset-config';
import {
  ensurePresetExtension,
  resolvePresetSaveDirectory,
  sanitizeFileStem,
} from './preset-paths';

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
  public async showSavePresetFileDialog(
    request: SavePresetFileRequest,
    baseDirectory: string,
    parentWindow?: BaseWindow,
  ): Promise<SelectedFilePath> {
    const spec = PRESET_FILE_SPECS[request.payload.presetType];
    const directory = resolvePresetSaveDirectory(baseDirectory, request);
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

  public async showOpenPresetFileDialog(
    request: OpenPresetFileRequest,
    directory: string,
    parentWindow?: BaseWindow,
  ): Promise<SelectedFilePath> {
    const spec = PRESET_FILE_SPECS[request.presetType];
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

    return {
      status: 'selected',
      filePath,
    };
  }
}
