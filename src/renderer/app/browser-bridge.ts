import { getRendererDeviceLabel } from '../../devices/registry-core';
import { getDeviceBrowserCategoryDirectoryName } from '../../devices/browser-categories';
import { browserPresetSaveDialog } from './browser-preset-save-dialog.svelte';
import { LIVE_BRIDGE_TARGET } from '../../shared/bridge/protocol';
import type { CompassApi } from '../../shared/contracts/ipc/api';
import { resolveShortcutPlatform } from '../../shared/keyboard-shortcuts';
import type { SavePresetFileRequest, SavePresetFileResponse } from '../../shared/contracts/ipc/presets';
import { PRESET_FILE_EXTENSIONS } from '../../shared/preset/file';
import { ensurePresetExtension, isValidPresetPathSegment, sanitizeFileStem } from '../../shared/preset/paths';
import { PresetRepository } from '../../shared/preset/repository';
import { BrowserPresetBackend, ROOT_LABELS, parseVirtualPresetPath, presetBrowserTreeChangedListeners } from './browser-preset-backend';
import {
  GITHUB_API_VERSION,
  GITHUB_LATEST_RELEASE_URL,
  GITHUB_RELEASES_API_URL,
  type GitHubReleaseResponse,
} from '../../shared/releases/github';
import { resolveUpdateCheckResponse } from '../../shared/releases/update-check';

// Request factories stay in the renderer; only their result crosses native IPC.
export interface RendererCompassApi extends CompassApi {
  savePresetFile: (
    request: SavePresetFileRequest | (() => SavePresetFileRequest),
  ) => Promise<SavePresetFileResponse>;
}
const readDevUpdateCheckOverride = (): string | null => {
  if (!import.meta.env.DEV) {
    return null;
  }

  const version = new URLSearchParams(window.location.search)
    .get('compassLatestVersion')
    ?.trim();
  return version || null;
};

const presetRepository = new PresetRepository(new BrowserPresetBackend());

const createNoopSubscription = (): (() => void) => () => {};

const createBrowserCompassBridge = (): RendererCompassApi => ({
  platform: resolveShortcutPlatform(navigator.userAgent),
  sendGeneratedPreview: async () => {
    throw new Error('Desktop app required to send to Ableton.');
  },
  requestAppVersion: async () => __APP_VERSION__,
  setApplicationLocale: async () => {},
  requestAppFocus: async () => document.hasFocus(),
  subscribeAppFocus: (listener) => {
    const handleFocus = (): void => listener(true);
    const handleBlur = (): void => listener(false);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  },
  performHapticFeedback: () => {},
  checkForUpdates: async () => {
    const currentVersion = __APP_VERSION__;

    try {
      const devLatestVersionOverride = readDevUpdateCheckOverride();
      if (devLatestVersionOverride) {
        return resolveUpdateCheckResponse(currentVersion, devLatestVersionOverride);
      }

      const response = await fetch(GITHUB_RELEASES_API_URL, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
        },
      });
      if (!response.ok) {
        throw new Error(`GitHub returned ${response.status}.`);
      }

      const release = await response.json() as GitHubReleaseResponse;
      if (release.draft === true || release.prerelease === true) {
        throw new Error('Latest release is not a stable release.');
      }
      if (typeof release.tag_name !== 'string' || !release.tag_name.trim()) {
        throw new Error('Latest release tag is missing.');
      }

      return resolveUpdateCheckResponse(currentVersion, release.tag_name);
    } catch (error) {
      const message = error instanceof Error && error.message.trim()
        ? error.message.trim()
        : 'Update check failed.';
      return { status: 'unavailable', currentVersion, message };
    }
  },
  openLatestReleasePage: async () => {
    window.open(GITHUB_LATEST_RELEASE_URL, '_blank', 'noopener,noreferrer');
  },
  requestLiveTempo: async () => ({
    sentAtIso: new Date().toISOString(),
    target: LIVE_BRIDGE_TARGET,
  }),
  openPreviewWindow: async () => {
    throw new Error('Preview popout is only available in the Electron app.');
  },
  sendPreviewWindowControlRequest: () => {},
  pushPreviewWindowState: () => {},
  requestPreviewWindowState: async () => null,
  requestPreviewWindowVisibility: async () => false,
  subscribePreviewWindowState: () => createNoopSubscription(),
  subscribePreviewWindowVisibility: () => createNoopSubscription(),
  subscribePreviewWindowControlRequest: () => createNoopSubscription(),
  subscribeMainWindowCloseRequest: () => createNoopSubscription(),
  subscribeMainWindowRackFileMenuRequest: () => createNoopSubscription(),
  requestMainWindowAlwaysOnTop: async () => false,
  setMainWindowAlwaysOnTop: async () => false,
  confirmMainWindowClose: async () => {},
  pushMainWindowDocumentState: () => {},
  subscribeLiveTempo: () => createNoopSubscription(),
  openExternal: async (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  getPathForFile: () => null,
  savePresetFile: async (requestOrFactory) => {
    const buildRequest = typeof requestOrFactory === 'function' ? requestOrFactory : () => requestOrFactory;
    const request = buildRequest();
    const presetType = request.payload.presetType;
    const folder = request.payload.presetType === 'device'
      ? [getDeviceBrowserCategoryDirectoryName(request.payload.device.kind), getRendererDeviceLabel(request.payload.device.kind)] : [];
    return browserPresetSaveDialog.show({
      name: sanitizeFileStem(request.suggestedName, ROOT_LABELS[presetType].slice(0, -1)),
      presetType,
      folder,
      save: async (name, folder, approvedConflict) => {
        if (!isValidPresetPathSegment(name)) return { status: 'invalid-name' };
        return presetRepository.savePresetAt({ presetType,
          relativePath: [...folder, ensurePresetExtension(name.trim(), PRESET_FILE_EXTENSIONS[presetType])] },
        buildRequest().payload, { conflict: approvedConflict });
      },
    });
  },
  saveRackFile: async (request) => {
    const entry = parseVirtualPresetPath(request.filePath);
    if (!entry || entry.presetType !== 'rack') return { status: 'error', message: 'Invalid browser rack path.' };
    const result = await presetRepository.savePresetAt(entry, request.payload, 'overwrite');
    if (result.status === 'saved' || result.status === 'error') return result;
    return { status: 'error', message: result.status === 'missing-folder' ? 'Parent folder does not exist.' : 'A folder with that name already exists.' };
  },
  updateRackFileInfo: async (request) => {
    const entry = parseVirtualPresetPath(request.filePath);
    if (!entry || entry.presetType !== 'rack') return { status: 'error', message: 'Invalid browser rack path.' };
    return presetRepository.updatePresetFileInfo({ ...entry, source: 'user', fileName: request.fileName, metadata: request.metadata });
  },
  renamePresetFile: (request) => presetRepository.renamePresetFile(request),
  updatePresetFileInfo: (request) => presetRepository.updatePresetFileInfo(request),
  createPresetFolder: (request) => presetRepository.createPresetFolder(request),
  renamePresetFolder: (request) => presetRepository.renamePresetFolder(request),
  listPresetBrowserTree: () => presetRepository.listPresetBrowserTree(),
  deletePresetEntries: (request) => presetRepository.deletePresetEntries(request),
  movePresetEntries: (request) => presetRepository.movePresetEntries(request),
  copyPresetEntries: (request) => presetRepository.copyPresetEntries(request),
  readPresetEntry: (request) => presetRepository.readPresetEntry(request),
  subscribePresetBrowserTreeChanged: (listener) => {
    presetBrowserTreeChangedListeners.add(listener);
    return () => { presetBrowserTreeChangedListeners.delete(listener); };
  },
  showPresetEntryInFolder: async () => ({ status: 'ok' }),
});

export const resolveCompassBridge = (): RendererCompassApi => {
  const nativeBridge = window.compass;
  return nativeBridge ? {
    ...nativeBridge,
    savePresetFile: (request) => nativeBridge.savePresetFile(
      typeof request === 'function' ? request() : request,
    ),
  } : createBrowserCompassBridge();
};
