import { LIVE_BRIDGE_TARGET } from '../../shared/bridge/protocol';
import {
  buildBundledRackPresetCollectionNode,
  readBundledRackPreset,
} from '../../shared/bundled-rack-presets';
import {
  isDeviceBrowserSystemDirectoryPath,
} from '../../devices/browser-categories';
import type { CompassApi } from '../../shared/contracts/ipc/api';
import { normalizeAuthoredMetadata } from '../../shared/model';
import {
  preparePresetEntryMove,
  type PresetEntryMovePlan,
} from '../../shared/preset-entry-move';
import {
  arePresetPathsEqual as relativePathEquals,
  doPresetPathsCollide as relativePathCollides,
  isPresetPathInside as relativePathContains,
  normalizePresetEntrySelection,
  type PresetEntryPath,
  type PresetEntrySelectionItem,
} from '../../shared/preset-entry-selection';
import type {
  PresetBrowserTreeFolderNode,
  PresetBrowserTreeNode,
  ReadPresetEntryRequest,
  ReadPresetEntryResponse,
  SavePresetFileRequest,
} from '../../shared/contracts/ipc/presets';
import {
  PRESET_FILE_EXTENSIONS,
  isPresetFileKind,
  parseStoredPresetValue,
  resolvePresetBrowserPreview,
  resolvePresetNameFromFileName,
  withPresetAuthoredMetadata,
  type PresetFile,
  type PresetFileKind,
} from '../../shared/presets';
import {
  GITHUB_API_VERSION,
  GITHUB_LATEST_RELEASE_URL,
  GITHUB_RELEASES_API_URL,
  type GitHubReleaseResponse,
} from '../../shared/releases/github';
import { resolveUpdateCheckResponse } from '../../shared/releases/update-check';

const STORAGE_KEY = 'compass:web-bridge:preset-store:v1';
const VIRTUAL_PRESET_ROOT = 'browser://presets';
const ROOT_LABELS: Record<PresetFileKind, string> = {
  device: 'Devices',
  group: 'Groups',
  rack: 'Racks',
};
const presetBrowserTreeChangedListeners = new Set<() => void>();

window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) {
    return;
  }

  for (const listener of presetBrowserTreeChangedListeners) {
    listener();
  }
});

interface BrowserPresetEntry {
  presetType: PresetFileKind;
  relativePath: string[];
  payload: PresetFile;
  needsSave: boolean;
}

interface BrowserPresetStore {
  folders: Record<PresetFileKind, string[][]>;
  files: BrowserPresetEntry[];
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

const createEmptyStore = (): BrowserPresetStore => ({
  folders: {
    device: [],
    group: [],
    rack: [],
  },
  files: [],
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const clonePreset = <K extends PresetFileKind>(
  preset: Extract<PresetFile, { presetType: K }>,
): Extract<PresetFile, { presetType: K }> =>
  JSON.parse(JSON.stringify(preset)) as Extract<PresetFile, { presetType: K }>;

const normalizePathSegment = (value: string): string => value.trim();

const isValidPathSegment = (value: string): boolean => {
  const normalized = normalizePathSegment(value);
  return normalized.length > 0
    && normalized !== '.'
    && normalized !== '..'
    && !/[\\/:*?"<>|]/.test(normalized);
};

const sanitizeFileStem = (value: string, fallback: string): string => {
  const sanitized = value
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return sanitized || fallback;
};

const ensurePresetExtension = (
  name: string,
  presetType: PresetFileKind,
): string => {
  const extension = PRESET_FILE_EXTENSIONS[presetType];
  return name.toLowerCase().endsWith(extension)
    ? name
    : `${name}${extension}`;
};

const parseVirtualPresetPath = (
  filePath: string,
): { presetType: PresetFileKind; relativePath: string[] } | null => {
  if (!filePath.startsWith(`${VIRTUAL_PRESET_ROOT}/`)) {
    return null;
  }

  const [presetTypeText, ...relativePath] = filePath.slice(VIRTUAL_PRESET_ROOT.length + 1).split('/');
  if (!isPresetFileKind(presetTypeText) || relativePath.length === 0) {
    return null;
  }

  return { presetType: presetTypeText, relativePath };
};

const toVirtualPresetPath = (
  presetType: PresetFileKind,
  relativePath: readonly string[],
): string =>
  `${VIRTUAL_PRESET_ROOT}/${presetType}/${relativePath.join('/')}`;

const getFileStem = (fileName: string, presetType: PresetFileKind): string => {
  return resolvePresetNameFromFileName(fileName, presetType) ?? fileName;
};

const readStore = (): BrowserPresetStore => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return createEmptyStore();
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.folders) || !Array.isArray(parsed.files)) {
      return createEmptyStore();
    }

    const store = createEmptyStore();
    for (const presetType of Object.keys(store.folders) as PresetFileKind[]) {
      const rawFolders = parsed.folders[presetType];
      store.folders[presetType] = Array.isArray(rawFolders)
        ? rawFolders.filter((path): path is string[] =>
            Array.isArray(path) && path.every((segment) => typeof segment === 'string'))
        : [];
    }

    for (const file of parsed.files) {
      if (
        !isRecord(file)
        || !isPresetFileKind(file.presetType)
        || !Array.isArray(file.relativePath)
        || !file.relativePath.every((segment) => typeof segment === 'string')
        || !isRecord(file.payload)
        || file.payload.presetType !== file.presetType
      ) {
        continue;
      }

      const parsedPayload = parseStoredPresetValue(file.payload);
      if (!parsedPayload || parsedPayload.preset.presetType !== file.presetType) {
        continue;
      }

      store.files.push({
        presetType: parsedPayload.preset.presetType,
        relativePath: file.relativePath,
        payload: parsedPayload.preset,
        needsSave: parsedPayload.needsSave,
      });
    }

    return store;
  } catch {
    return createEmptyStore();
  }
};

const writeStore = (store: BrowserPresetStore): void => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
};

const collectStorePaths = (
  store: BrowserPresetStore,
): PresetEntryPath[] => [
  ...(['device', 'group', 'rack'] as const).flatMap((presetType) =>
    store.folders[presetType].map((relativePath) => ({
      presetType,
      relativePath,
    }))),
  ...store.files.map((file) => ({
    presetType: file.presetType,
    relativePath: file.relativePath,
  })),
];

const hasStoreEntry = (
  store: BrowserPresetStore,
  entry: PresetEntrySelectionItem,
): boolean =>
  entry.entryKind === 'file'
    ? store.files.some(
        (file) =>
          file.presetType === entry.presetType
          && relativePathEquals(file.relativePath, entry.relativePath),
      )
    : store.folders[entry.presetType].some((path) =>
        relativePathEquals(path, entry.relativePath));

const mapStoreEntryPaths = (
  store: BrowserPresetStore,
  presetType: PresetFileKind,
  mapPath: (
    relativePath: string[],
    entryKind: PresetEntrySelectionItem['entryKind'],
  ) => string[],
): void => {
  store.folders[presetType] = store.folders[presetType].map((path) =>
    mapPath(path, 'directory'));
  store.files = store.files.map((file) =>
    file.presetType === presetType
      ? { ...file, relativePath: mapPath(file.relativePath, 'file') }
      : file);
};

const applyMovePlansToPath = (
  relativePath: string[],
  entryKind: PresetEntrySelectionItem['entryKind'],
  plans: readonly PresetEntryMovePlan[],
): string[] => {
  const plan = plans.find(({ entry, isNoop }) =>
    !isNoop
    && (
      entry.entryKind === 'directory'
        ? relativePathContains(entry.relativePath, relativePath)
        : entryKind === 'file'
          && relativePathEquals(entry.relativePath, relativePath)
    ));
  return plan
    ? [...plan.relativePath, ...relativePath.slice(plan.entry.relativePath.length)]
    : relativePath;
};

const sortByLabel = <T extends { label: string }>(entries: T[]): T[] =>
  entries.sort((left, right) =>
    left.label.localeCompare(right.label, undefined, {
      numeric: true,
      sensitivity: 'base',
    }));

const buildChildren = (
  store: BrowserPresetStore,
  presetType: PresetFileKind,
  relativePath: readonly string[],
): PresetBrowserTreeNode[] => {
  const folderChildren = store.folders[presetType]
    .filter((folderPath) =>
      folderPath.length === relativePath.length + 1
      && relativePathEquals(folderPath.slice(0, -1), relativePath))
    .map((folderPath): PresetBrowserTreeFolderNode => ({
      kind: 'folder',
      id: `preset:${presetType}:${folderPath.join('/')}`,
      label: folderPath[folderPath.length - 1] ?? '',
      presetType,
      source: 'user',
      relativePath: [...folderPath],
      children: buildChildren(store, presetType, folderPath),
    }));

  const fileChildren = store.files
    .filter((file) =>
      file.presetType === presetType
      && file.relativePath.length === relativePath.length + 1
      && relativePathEquals(file.relativePath.slice(0, -1), relativePath))
    .map((file): PresetBrowserTreeNode => {
      const preview = resolvePresetBrowserPreview(file.payload);
      return {
        kind: 'preset',
        id: `preset:${presetType}:${file.relativePath.join('/')}`,
        label: getFileStem(file.relativePath[file.relativePath.length - 1] ?? '', presetType),
        presetType,
        source: 'user',
        relativePath: [...file.relativePath],
        loadStatus: 'loaded',
        savedAtIso: file.payload.savedAtIso,
        ...(preview ? { preview } : {}),
        ...(file.payload.presetType === 'device'
          ? {
              deviceKind: file.payload.device.kind,
            }
          : {}),
      };
    });

  return [
    ...sortByLabel(folderChildren),
    ...sortByLabel(fileChildren),
  ];
};

const upsertPresetFile = <K extends PresetFileKind>(
  store: BrowserPresetStore,
  presetType: K,
  relativePath: string[],
  payload: Extract<PresetFile, { presetType: K }>,
): boolean => {
  if (
    store.folders[presetType].some((path) =>
      relativePathCollides(path, relativePath))
  ) {
    return false;
  }

  const existingIndex = store.files.findIndex((file) =>
    file.presetType === presetType
    && relativePathCollides(file.relativePath, relativePath));
  const entry: BrowserPresetEntry = {
    presetType,
    relativePath,
    payload: clonePreset(payload),
    needsSave: false,
  };

  if (existingIndex === -1) {
    store.files.push(entry);
  } else {
    store.files[existingIndex] = entry;
  }

  return true;
};

type BrowserPresetFilePathChange = {
  fileIndex: number;
  nextRelativePath: string[];
  hasCollision: boolean;
};

const prepareBrowserPresetFilePathChange = (
  store: BrowserPresetStore,
  presetType: PresetFileKind,
  relativePath: readonly string[],
  rawFileName: string,
  fallbackFileName = 'Preset',
): BrowserPresetFilePathChange | null => {
  const currentFileName = relativePath[relativePath.length - 1] ?? fallbackFileName;
  const fileName = ensurePresetExtension(
    sanitizeFileStem(
      rawFileName,
      getFileStem(currentFileName, presetType),
    ),
    presetType,
  );
  const nextRelativePath = [...relativePath.slice(0, -1), fileName];
  const fileIndex = store.files.findIndex((file) =>
    file.presetType === presetType
    && relativePathEquals(file.relativePath, relativePath));
  if (fileIndex === -1) {
    return null;
  }

  const hasCollision = store.files.some((file, index) =>
    index !== fileIndex
    && file.presetType === presetType
    && relativePathCollides(file.relativePath, nextRelativePath))
    || store.folders[presetType].some((path) =>
      relativePathCollides(path, nextRelativePath));

  return { fileIndex, nextRelativePath, hasCollision };
};

const applyBrowserPresetInfoChange = (
  store: BrowserPresetStore,
  pathChange: BrowserPresetFilePathChange,
  metadata: unknown,
  savedAtIso: string,
): void => {
  const current = store.files[pathChange.fileIndex];
  store.files[pathChange.fileIndex] = {
    ...current,
    relativePath: pathChange.nextRelativePath,
    payload: withPresetAuthoredMetadata(
      current.payload,
      normalizeAuthoredMetadata(metadata),
      savedAtIso,
    ),
    needsSave: false,
  };
};

const createNoopSubscription = (): (() => void) => () => {};

const createBrowserCompassBridge = (): CompassApi => ({
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
  savePresetFile: async (request: SavePresetFileRequest) => {
    const presetType = request.payload.presetType;
    const fileName = ensurePresetExtension(
      sanitizeFileStem(request.suggestedName, ROOT_LABELS[presetType].slice(0, -1) || 'Preset'),
      presetType,
    );
    const relativePath = [fileName];
    const store = readStore();
    if (!upsertPresetFile(store, presetType, relativePath, request.payload)) {
      return {
        status: 'error',
        message: 'A folder with that name already exists.',
      };
    }
    writeStore(store);

    return {
      status: 'saved',
      filePath: toVirtualPresetPath(presetType, relativePath),
    };
  },
  saveRackFile: async (request) => {
    const parsed = parseVirtualPresetPath(request.filePath);
    if (!parsed || parsed.presetType !== 'rack') {
      return {
        status: 'error',
        message: 'Browser rack saves require a browser preset path.',
        filePath: request.filePath,
      };
    }

    const store = readStore();
    if (!upsertPresetFile(store, 'rack', parsed.relativePath, request.payload)) {
      return {
        status: 'error',
        message: 'A folder with that name already exists.',
        filePath: request.filePath,
      };
    }
    writeStore(store);
    return {
      status: 'saved',
      filePath: request.filePath,
    };
  },
  updateRackFileInfo: async (request) => {
    const parsed = parseVirtualPresetPath(request.filePath);
    if (!parsed || parsed.presetType !== 'rack') {
      return {
        status: 'error',
        message: 'Browser rack info updates require a browser preset path.',
        filePath: request.filePath,
      };
    }

    const store = readStore();
    const pathChange = prepareBrowserPresetFilePathChange(
      store,
      'rack',
      parsed.relativePath,
      request.fileName,
      'Rack',
    );
    if (!pathChange) {
      return { status: 'error', message: 'Rack file does not exist.', filePath: request.filePath };
    }
    if (pathChange.hasCollision) {
      return {
        status: 'error',
        message: 'An item or folder with that name already exists.',
        filePath: request.filePath,
      };
    }

    const savedAtIso = new Date().toISOString();
    applyBrowserPresetInfoChange(store, pathChange, request.metadata, savedAtIso);
    writeStore(store);
    return {
      status: 'updated',
      filePath: toVirtualPresetPath('rack', pathChange.nextRelativePath),
      savedAtIso,
    };
  },
  renamePresetFile: async (request) => {
    const store = readStore();
    const pathChange = prepareBrowserPresetFilePathChange(
      store,
      request.presetType,
      request.relativePath,
      request.fileName,
    );
    if (!pathChange) {
      return { status: 'error', message: 'Preset file does not exist.' };
    }
    if (relativePathEquals(request.relativePath, pathChange.nextRelativePath)) {
      return {
        status: 'renamed',
        relativePath: request.relativePath,
        sourcePath: toVirtualPresetPath(request.presetType, request.relativePath),
        filePath: toVirtualPresetPath(request.presetType, request.relativePath),
      };
    }
    if (pathChange.hasCollision) {
      return { status: 'error', message: 'An item or folder with that name already exists.' };
    }

    store.files[pathChange.fileIndex] = {
      ...store.files[pathChange.fileIndex],
      relativePath: pathChange.nextRelativePath,
    };
    writeStore(store);
    return {
      status: 'renamed',
      relativePath: pathChange.nextRelativePath,
      sourcePath: toVirtualPresetPath(request.presetType, request.relativePath),
      filePath: toVirtualPresetPath(request.presetType, pathChange.nextRelativePath),
    };
  },
  updatePresetFileInfo: async (request) => {
    const store = readStore();
    const pathChange = prepareBrowserPresetFilePathChange(
      store,
      request.presetType,
      request.relativePath,
      request.fileName,
    );
    if (!pathChange) {
      return { status: 'error', message: 'Preset file does not exist.' };
    }
    if (pathChange.hasCollision) {
      return { status: 'error', message: 'An item or folder with that name already exists.' };
    }

    const savedAtIso = new Date().toISOString();
    const sourcePath = toVirtualPresetPath(request.presetType, request.relativePath);
    const filePath = toVirtualPresetPath(request.presetType, pathChange.nextRelativePath);
    applyBrowserPresetInfoChange(store, pathChange, request.metadata, savedAtIso);
    writeStore(store);
    return {
      status: 'updated',
      relativePath: pathChange.nextRelativePath,
      sourcePath,
      filePath,
      savedAtIso,
    };
  },
  createPresetFolder: async (request) => {
    const folderName = normalizePathSegment(request.folderName);
    if (!isValidPathSegment(folderName)) {
      return { status: 'error', message: 'Invalid folder name.' };
    }

    const relativePath = [...request.relativePath, folderName];
    if (
      request.presetType === 'device'
      && isDeviceBrowserSystemDirectoryPath(relativePath)
    ) {
      return {
        status: 'error',
        message: 'Built-in device folder names are reserved.',
      };
    }
    const store = readStore();
    if (
      store.folders[request.presetType].some((path) =>
        relativePathCollides(path, relativePath))
      || store.files.some((file) =>
        file.presetType === request.presetType
        && relativePathCollides(file.relativePath, relativePath))
    ) {
      return { status: 'error', message: 'An item or folder with that name already exists.' };
    }

    store.folders[request.presetType].push(relativePath);
    writeStore(store);
    return { status: 'ok', relativePath };
  },
  renamePresetFolder: async (request) => {
    if (request.relativePath.length === 0) {
      return { status: 'error', message: 'Preset root folders cannot be renamed.' };
    }
    if (
      request.presetType === 'device'
      && isDeviceBrowserSystemDirectoryPath(request.relativePath)
    ) {
      return { status: 'error', message: 'Built-in device folders cannot be renamed.' };
    }

    const folderName = normalizePathSegment(request.folderName);
    if (!isValidPathSegment(folderName)) {
      return { status: 'error', message: 'Invalid folder name.' };
    }

    const nextRelativePath = [...request.relativePath.slice(0, -1), folderName];
    if (
      request.presetType === 'device'
      && isDeviceBrowserSystemDirectoryPath(nextRelativePath)
    ) {
      return {
        status: 'error',
        message: 'Built-in device folder names are reserved.',
      };
    }
    const store = readStore();
    const folderIndex = store.folders[request.presetType].findIndex((path) =>
      relativePathEquals(path, request.relativePath));
    if (folderIndex === -1) {
      return { status: 'error', message: 'Folder does not exist.' };
    }
    if (
      store.folders[request.presetType].some(
        (path, index) =>
          index !== folderIndex
          && relativePathCollides(path, nextRelativePath),
      )
      || store.files.some(
        (file) =>
          file.presetType === request.presetType
          && relativePathCollides(file.relativePath, nextRelativePath),
      )
    ) {
      return { status: 'error', message: 'An item or folder with that name already exists.' };
    }

    const renamePlan: PresetEntryMovePlan = {
      entry: {
        presetType: request.presetType,
        entryKind: 'directory',
        relativePath: request.relativePath,
      },
      relativePath: nextRelativePath,
      isNoop: false,
    };
    mapStoreEntryPaths(store, request.presetType, (path, entryKind) =>
      applyMovePlansToPath(path, entryKind, [renamePlan]));
    writeStore(store);
    return {
      status: 'ok',
      relativePath: nextRelativePath,
      sourcePath: toVirtualPresetPath(
        request.presetType,
        request.relativePath,
      ),
      filePath: toVirtualPresetPath(request.presetType, nextRelativePath),
    };
  },
  listPresetBrowserTree: async () => {
    const store = readStore();
    return {
      status: 'ok',
      tree: (['device', 'group', 'rack'] as const).map((presetType) => ({
        kind: 'folder',
        id: `preset-root:${presetType}`,
        label: ROOT_LABELS[presetType],
        presetType,
        source: 'user' as const,
        relativePath: [] as string[],
        children: presetType === 'rack'
          ? [buildBundledRackPresetCollectionNode(), ...buildChildren(store, presetType, [])]
          : buildChildren(store, presetType, []),
      })),
      occupiedPaths: collectStorePaths(store),
    };
  },
  subscribePresetBrowserTreeChanged: (listener) => {
    presetBrowserTreeChangedListeners.add(listener);
    return () => {
      presetBrowserTreeChangedListeners.delete(listener);
    };
  },
  showPresetEntryInFolder: async () => ({ status: 'ok' }),
  deletePresetEntries: async (request) => {
    if (
      request.entries.length === 0
      || request.entries.some((entry) => entry.relativePath.length === 0)
    ) {
      return {
        status: 'error',
        message: 'Preset root folders cannot be deleted.',
      };
    }

    const normalizedEntries = normalizePresetEntrySelection(request.entries);
    if (
      normalizedEntries.some(
        (entry) =>
          entry.entryKind === 'directory'
          && entry.presetType === 'device'
          && isDeviceBrowserSystemDirectoryPath(entry.relativePath),
      )
    ) {
      return {
        status: 'error',
        message: 'Built-in device folders cannot be deleted.',
      };
    }
    const store = readStore();
    const hasMatchingEntry = normalizedEntries.every((entry) =>
      hasStoreEntry(store, entry));
    if (!hasMatchingEntry) {
      return {
        status: 'error',
        message: 'Preset item type does not match the request.',
      };
    }

    const deletedEntries = normalizedEntries.map((entry) => ({
      ...entry,
      relativePath: [...entry.relativePath],
      filePath: toVirtualPresetPath(entry.presetType, entry.relativePath),
    }));
    for (const entry of normalizedEntries) {
      if (entry.entryKind === 'file') {
        store.files = store.files.filter((file) =>
          file.presetType !== entry.presetType
          || !relativePathEquals(file.relativePath, entry.relativePath));
      } else {
        store.folders[entry.presetType] = store.folders[entry.presetType].filter((path) =>
          !relativePathContains(entry.relativePath, path));
        store.files = store.files.filter((file) =>
          file.presetType !== entry.presetType
          || !relativePathContains(entry.relativePath, file.relativePath));
      }
    }
    writeStore(store);
    return { status: 'ok', entries: deletedEntries };
  },
  movePresetEntries: async (request) => {
    const store = readStore();
    const movePlan = preparePresetEntryMove(
      request.entries,
      request.destination,
      collectStorePaths(store),
    );
    if (movePlan.status === 'error') {
      return movePlan;
    }
    const { presetType, destinationRelativePath } = movePlan;

    const destinationExists =
      destinationRelativePath.length === 0
      || store.folders[presetType].some((path) =>
        relativePathCollides(path, destinationRelativePath));
    const canCreateDestination = movePlan.createDestination;
    if (!destinationExists && !canCreateDestination) {
      return { status: 'error', message: 'Destination folder does not exist.' };
    }
    if (
      store.files.some(
        (file) =>
          file.presetType === presetType
          && relativePathCollides(file.relativePath, destinationRelativePath),
      )
    ) {
      return { status: 'error', message: 'Destination is not a folder.' };
    }

    if (!movePlan.plans.every(({ entry }) => hasStoreEntry(store, entry))) {
      return {
        status: 'error',
        message: 'Preset item type does not match the request.',
      };
    }

    if (canCreateDestination && !destinationExists) {
      for (let index = 0; index < destinationRelativePath.length; index += 1) {
        const folderPath = destinationRelativePath.slice(0, index + 1);
        if (
          !store.folders[presetType].some((path) =>
            relativePathCollides(path, folderPath))
        ) {
          store.folders[presetType].push(folderPath);
        }
      }
    }

    mapStoreEntryPaths(
      store,
      presetType,
      (path, entryKind) =>
        applyMovePlansToPath(path, entryKind, movePlan.plans),
    );

    writeStore(store);
    return {
      status: 'ok',
      entries: movePlan.plans.map((plan) => ({
        presetType,
        entryKind: plan.entry.entryKind,
        relativePath: [...plan.relativePath],
        sourcePath: toVirtualPresetPath(presetType, plan.entry.relativePath),
        filePath: toVirtualPresetPath(presetType, plan.relativePath),
      })),
    };
  },
  readPresetEntry: async <K extends PresetFileKind>(
    request: ReadPresetEntryRequest<K>,
  ): Promise<ReadPresetEntryResponse<K>> => {
    if (request.source === 'bundled') {
      return readBundledRackPreset(
        request.presetType,
        request.relativePath,
      );
    }

    const store = readStore();
    const entry = store.files.find((file) =>
      file.presetType === request.presetType && relativePathEquals(file.relativePath, request.relativePath));
    if (!entry) {
      return {
        status: 'error',
        errorCode: 'preset-not-found',
        message: 'Preset does not exist.',
      };
    }

    return {
      status: 'loaded',
      filePath: toVirtualPresetPath(request.presetType, request.relativePath),
      payload: clonePreset(entry.payload as Extract<PresetFile, { presetType: K }>),
      needsSave: entry.needsSave,
    };
  },
});

export const resolveCompassBridge = (): CompassApi =>
  window.compass ?? createBrowserCompassBridge();
