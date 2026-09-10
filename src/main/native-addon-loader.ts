import { app } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';

const nativeRequire = createRequire(__filename);

export const loadMacosNativeAddon = <T>(
  fileName: string,
  description: string,
): T | null => {
  if (process.platform !== 'darwin') {
    return null;
  }

  const addonRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : app.getAppPath();
  const addonPath = path.join(
    addonRoot,
    'native',
    'macos',
    'build',
    'Release',
    fileName,
  );

  try {
    return nativeRequire(addonPath) as T;
  } catch (error) {
    console.warn(`${description} is unavailable:`, error);
    return null;
  }
};
