import type {
  CreatePresetFolderRequest,
  ReadPresetEntryRequest,
  SavePresetFileRequest,
  ShowPresetEntryInFolderRequest,
} from '../../../shared/contracts/ipc/presets';
import {
  isPresetFileKind,
  parsePresetFile,
  type PresetFileKind,
} from '../../../shared/presets';
import { isValidPresetPathSegment } from './preset-paths';

export const parseSavePresetFileRequest = (
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

const isValidRelativePathSegment = (value: unknown): value is string =>
  typeof value === 'string' && isValidPresetPathSegment(value);

const parseRelativePath = (value: unknown): string[] | null => {
  if (!Array.isArray(value) || !value.every((segment) => isValidRelativePathSegment(segment))) {
    return null;
  }

  return [...value];
};

export const parseReadPresetEntryRequest = (
  value: unknown,
): ReadPresetEntryRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || !isPresetFileKind((value as { presetType?: unknown }).presetType)
  ) {
    return null;
  }

  const relativePath = parseRelativePath((value as { relativePath?: unknown }).relativePath);
  if (!relativePath || relativePath.length === 0) {
    return null;
  }

  return {
    presetType: (value as { presetType: PresetFileKind }).presetType,
    relativePath,
  };
};

export const parsePresetEntryRequest = (
  value: unknown,
): ShowPresetEntryInFolderRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || !isPresetFileKind((value as { presetType?: unknown }).presetType)
  ) {
    return null;
  }

  const relativePath = parseRelativePath((value as { relativePath?: unknown }).relativePath);
  const entryKind = (value as { entryKind?: unknown }).entryKind;
  if (!relativePath || (entryKind !== 'file' && entryKind !== 'directory')) {
    return null;
  }

  return {
    presetType: (value as { presetType: PresetFileKind }).presetType,
    relativePath,
    entryKind,
  };
};

export const parseCreatePresetFolderRequest = (
  value: unknown,
): CreatePresetFolderRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || !isPresetFileKind((value as { presetType?: unknown }).presetType)
    || typeof (value as { folderName?: unknown }).folderName !== 'string'
  ) {
    return null;
  }

  const relativePath = parseRelativePath((value as { relativePath?: unknown }).relativePath);
  if (!relativePath) {
    return null;
  }

  return {
    presetType: (value as { presetType: PresetFileKind }).presetType,
    relativePath,
    folderName: (value as { folderName: string }).folderName,
  };
};
