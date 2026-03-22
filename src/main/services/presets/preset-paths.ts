import path from 'node:path';

import { getRendererDeviceLabel } from '../../../devices/schema-registry';
import type { SavePresetFileRequest } from '../../../shared/contracts/ipc/presets';

export const sanitizeFileStem = (value: string, fallback: string): string => {
  const trimmed = value.trim();
  const sanitized = trimmed
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || fallback;
};

export const resolvePresetSaveDirectory = (
  baseDirectory: string,
  request: SavePresetFileRequest,
): string => {
  if (request.payload.presetType !== 'device') {
    return baseDirectory;
  }

  const deviceDirectoryName = sanitizeFileStem(
    getRendererDeviceLabel(request.payload.device.kind),
    'Device',
  );
  return path.join(baseDirectory, deviceDirectoryName);
};

export const hasPresetExtension = (
  filePath: string,
  extension: string,
): boolean => filePath.toLowerCase().endsWith(extension);

export const ensurePresetExtension = (
  filePath: string,
  extension: string,
): string => {
  if (hasPresetExtension(filePath, extension)) {
    return filePath;
  }

  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
};

export const resolvePresetPath = (
  rootDirectory: string,
  relativePath: readonly string[],
): string | null => {
  const resolvedRoot = path.resolve(rootDirectory);
  const resolvedPath = path.resolve(rootDirectory, ...relativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    return null;
  }

  return resolvedPath;
};
