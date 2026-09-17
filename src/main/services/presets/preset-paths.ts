import path from 'node:path';

import { getDeviceBrowserCategoryDirectoryName } from '../../../devices/browser-categories';
import { getRendererDeviceLabel } from '../../../devices/schema-registry';
import type { SavePresetFileRequest } from '../../../shared/contracts/ipc/presets';

import { sanitizeFileStem } from '../../../shared/preset/paths';

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
  return path.join(
    baseDirectory,
    getDeviceBrowserCategoryDirectoryName(request.payload.device.kind),
    deviceDirectoryName,
  );
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
