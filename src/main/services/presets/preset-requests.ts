import type {
  CreatePresetFolderRequest,
  DeletePresetEntriesRequest,
  MovePresetEntriesRequest,
  ReadPresetEntryRequest,
  RenamePresetFileRequest,
  RenamePresetFolderRequest,
  SaveRackFileRequest,
  SavePresetFileRequest,
  ShowPresetEntryInFolderRequest,
  UpdatePresetFileInfoRequest,
  UpdateRackFileInfoRequest,
} from '../../../shared/contracts/ipc/presets';
import {
  isPresetFileKind,
  parsePresetFile,
  type PresetFileKind,
} from '../../../shared/presets';
import {
  normalizeAuthoredMetadata,
  type AuthoredMetadata,
} from '../../../shared/model';
import { isSafePresetRelativePathSegment } from './preset-paths';

const parseOptionalAuthoredMetadata = (
  value: unknown,
): { valid: boolean; metadata?: AuthoredMetadata } => {
  if (value === undefined) {
    return { valid: true };
  }
  if (
    typeof value !== 'object'
    || value === null
    || (
      (value as { author?: unknown }).author !== undefined
      && typeof (value as { author?: unknown }).author !== 'string'
    )
    || (
      (value as { description?: unknown }).description !== undefined
      && typeof (value as { description?: unknown }).description !== 'string'
    )
  ) {
    return { valid: false };
  }

  const metadata = normalizeAuthoredMetadata(value);
  return metadata
    ? { valid: true, metadata }
    : { valid: true };
};

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

  const payload = parsePresetFile((value as { payload?: unknown }).payload);
  if (!payload) {
    return null;
  }

  return {
    suggestedName: (value as { suggestedName: string }).suggestedName,
    payload: payload.preset,
  };
};

export const parseSaveRackFileRequest = (
  value: unknown,
): SaveRackFileRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || typeof (value as { filePath?: unknown }).filePath !== 'string'
  ) {
    return null;
  }

  const payload = parsePresetFile((value as { payload?: unknown }).payload);
  if (!payload || payload.preset.presetType !== 'rack') {
    return null;
  }

  return {
    filePath: (value as { filePath: string }).filePath,
    payload: payload.preset,
  };
};

export const parseUpdateRackFileInfoRequest = (
  value: unknown,
): UpdateRackFileInfoRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || typeof (value as { filePath?: unknown }).filePath !== 'string'
    || typeof (value as { fileName?: unknown }).fileName !== 'string'
  ) {
    return null;
  }

  const parsedMetadata = parseOptionalAuthoredMetadata(
    (value as { metadata?: unknown }).metadata,
  );
  if (!parsedMetadata.valid) {
    return null;
  }

  return {
    filePath: (value as { filePath: string }).filePath,
    fileName: (value as { fileName: string }).fileName,
    ...(parsedMetadata.metadata ? { metadata: parsedMetadata.metadata } : {}),
  };
};

const isValidRelativePathSegment = (value: unknown): value is string =>
  typeof value === 'string' && isSafePresetRelativePathSegment(value);

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

export const parseDeletePresetEntriesRequest = (
  value: unknown,
): DeletePresetEntriesRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || !Array.isArray((value as { entries?: unknown }).entries)
  ) {
    return null;
  }

  const entries = (value as { entries: unknown[] }).entries;
  if (entries.length === 0 || entries.length > 1000) {
    return null;
  }

  const parsedEntries: DeletePresetEntriesRequest['entries'] = [];
  for (const entry of entries) {
    const parsedEntry = parsePresetEntryRequest(entry);
    if (!parsedEntry) {
      return null;
    }
    parsedEntries.push(parsedEntry);
  }

  return {
    entries: parsedEntries,
  };
};

export const parseMovePresetEntriesRequest = (
  value: unknown,
): MovePresetEntriesRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || typeof (value as { destination?: unknown }).destination !== 'object'
    || (value as { destination: unknown }).destination === null
  ) {
    return null;
  }

  const entriesRequest = parseDeletePresetEntriesRequest(value);
  if (!entriesRequest) {
    return null;
  }

  const destination = (value as {
    destination: {
      presetType?: unknown;
      relativePath?: unknown;
    };
  }).destination;
  if (!isPresetFileKind(destination.presetType)) {
    return null;
  }

  const relativePath = parseRelativePath(destination.relativePath);
  if (!relativePath) {
    return null;
  }

  return {
    entries: entriesRequest.entries,
    destination: {
      presetType: destination.presetType,
      relativePath,
    },
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

export const parseRenamePresetFileRequest = (
  value: unknown,
): RenamePresetFileRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || !isPresetFileKind((value as { presetType?: unknown }).presetType)
    || typeof (value as { fileName?: unknown }).fileName !== 'string'
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
    fileName: (value as { fileName: string }).fileName,
  };
};

export const parseUpdatePresetFileInfoRequest = (
  value: unknown,
): UpdatePresetFileInfoRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || !isPresetFileKind((value as { presetType?: unknown }).presetType)
    || typeof (value as { fileName?: unknown }).fileName !== 'string'
  ) {
    return null;
  }

  const relativePath = parseRelativePath(
    (value as { relativePath?: unknown }).relativePath,
  );
  if (!relativePath || relativePath.length === 0) {
    return null;
  }

  const parsedMetadata = parseOptionalAuthoredMetadata(
    (value as { metadata?: unknown }).metadata,
  );
  if (!parsedMetadata.valid) {
    return null;
  }

  return {
    presetType: (value as { presetType: PresetFileKind }).presetType,
    relativePath,
    fileName: (value as { fileName: string }).fileName,
    ...(parsedMetadata.metadata ? { metadata: parsedMetadata.metadata } : {}),
  };
};

export const parseRenamePresetFolderRequest = (
  value: unknown,
): RenamePresetFolderRequest | null => {
  if (
    typeof value !== 'object'
    || value === null
    || !isPresetFileKind((value as { presetType?: unknown }).presetType)
    || typeof (value as { folderName?: unknown }).folderName !== 'string'
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
    folderName: (value as { folderName: string }).folderName,
  };
};
