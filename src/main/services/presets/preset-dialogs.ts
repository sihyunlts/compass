import {
  dialog,
  type BaseWindow,
  type SaveDialogOptions,
} from 'electron';
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
}
