import { LIVE_BRIDGE_TARGET } from '../../shared/bridge/protocol';
import type { CompassApi } from '../../shared/contracts/ipc/api';
import type {
  PresetBrowserTreeFolderNode,
  PresetBrowserTreeNode,
  ReadPresetEntryResponse,
  SavePresetFileRequest,
} from '../../shared/contracts/ipc/presets';
import {
  PRESET_FILE_EXTENSIONS,
  type PresetFile,
  type PresetFileKind,
} from '../../shared/presets';

const STORAGE_KEY = 'compass:web-bridge:preset-store:v1';
const VIRTUAL_PRESET_ROOT = 'browser://presets';
const ROOT_LABELS: Record<PresetFileKind, string> = {
  device: 'Devices',
  group: 'Groups',
  rack: 'Racks',
};

interface BrowserPresetEntry {
  presetType: PresetFileKind;
  relativePath: string[];
  payload: PresetFile;
}

interface BrowserPresetStore {
  folders: Record<PresetFileKind, string[][]>;
  files: BrowserPresetEntry[];
}

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

const isPresetFileKind = (value: unknown): value is PresetFileKind =>
  value === 'device' || value === 'group' || value === 'rack';

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

const relativePathEquals = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length
  && left.every((segment, index) => segment === right[index]);

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
  const extension = PRESET_FILE_EXTENSIONS[presetType];
  return fileName.toLowerCase().endsWith(extension)
    ? fileName.slice(0, -extension.length)
    : fileName;
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

      store.files.push({
        presetType: file.presetType,
        relativePath: file.relativePath,
        payload: file.payload as unknown as PresetFile,
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
      relativePath: [...folderPath],
      children: buildChildren(store, presetType, folderPath),
    }));

  const fileChildren = store.files
    .filter((file) =>
      file.presetType === presetType
      && file.relativePath.length === relativePath.length + 1
      && relativePathEquals(file.relativePath.slice(0, -1), relativePath))
    .map((file): PresetBrowserTreeNode => ({
      kind: 'preset',
      id: `preset:${presetType}:${file.relativePath.join('/')}`,
      label: getFileStem(file.relativePath[file.relativePath.length - 1] ?? '', presetType),
      presetType,
      relativePath: [...file.relativePath],
      savedAtIso: file.payload.savedAtIso,
      ...(file.payload.presetType === 'device'
        ? {
            deviceKind: file.payload.device.kind,
          }
        : {}),
    }));

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
): void => {
  const existingIndex = store.files.findIndex((file) =>
    file.presetType === presetType && relativePathEquals(file.relativePath, relativePath));
  const entry: BrowserPresetEntry = {
    presetType,
    relativePath,
    payload: clonePreset(payload),
  };

  if (existingIndex === -1) {
    store.files.push(entry);
    return;
  }

  store.files[existingIndex] = entry;
};

const createNoopSubscription = (): (() => void) => () => {};

export const createBrowserCompassBridge = (): CompassApi => ({
  sendGeneratedPreview: async () => {
    throw new Error('Desktop app required to send to Ableton.');
  },
  requestAppVersion: async () => __APP_VERSION__,
  requestLiveTempo: async () => ({
    sentAtIso: new Date().toISOString(),
    target: LIVE_BRIDGE_TARGET,
  }),
  openPreviewWindow: async () => {
    throw new Error('Preview popout is only available in the Electron app.');
  },
  pushPreviewWindowState: () => {},
  requestPreviewWindowState: async () => null,
  requestPreviewWindowVisibility: async () => false,
  subscribePreviewWindowState: () => createNoopSubscription(),
  subscribePreviewWindowVisibility: () => createNoopSubscription(),
  subscribeMainWindowCloseRequest: () => createNoopSubscription(),
  subscribeMainWindowRackFileMenuRequest: () => createNoopSubscription(),
  confirmMainWindowClose: async () => {},
  pushMainWindowDocumentState: () => {},
  subscribeLiveTempo: () => createNoopSubscription(),
  openExternal: async (url) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  },
  savePresetFile: async (request: SavePresetFileRequest) => {
    const presetType = request.payload.presetType;
    const fileName = ensurePresetExtension(
      sanitizeFileStem(request.suggestedName, ROOT_LABELS[presetType].slice(0, -1) || 'Preset'),
      presetType,
    );
    const relativePath = [fileName];
    const store = readStore();
    upsertPresetFile(store, presetType, relativePath, request.payload);
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
    upsertPresetFile(store, 'rack', parsed.relativePath, request.payload);
    writeStore(store);
    return {
      status: 'saved',
      filePath: request.filePath,
    };
  },
  renameRackFile: async (request) => {
    const parsed = parseVirtualPresetPath(request.filePath);
    if (!parsed || parsed.presetType !== 'rack') {
      return {
        status: 'error',
        message: 'Browser rack renames require a browser preset path.',
        filePath: request.filePath,
      };
    }

    const fileName = ensurePresetExtension(
      sanitizeFileStem(
        request.fileName,
        getFileStem(parsed.relativePath[parsed.relativePath.length - 1] ?? 'Rack', 'rack'),
      ),
      'rack',
    );
    const nextRelativePath = [...parsed.relativePath.slice(0, -1), fileName];
    const store = readStore();
    const fileIndex = store.files.findIndex((file) =>
      file.presetType === 'rack' && relativePathEquals(file.relativePath, parsed.relativePath));
    if (fileIndex === -1) {
      return { status: 'error', message: 'Rack file does not exist.', filePath: request.filePath };
    }
    if (relativePathEquals(parsed.relativePath, nextRelativePath)) {
      return { status: 'renamed', filePath: request.filePath };
    }
    if (
      store.files.some((file) =>
        file.presetType === 'rack' && relativePathEquals(file.relativePath, nextRelativePath))
      || store.folders.rack.some((path) => relativePathEquals(path, nextRelativePath))
    ) {
      return {
        status: 'error',
        message: 'An item or folder with that name already exists.',
        filePath: request.filePath,
      };
    }

    store.files[fileIndex] = {
      ...store.files[fileIndex],
      relativePath: nextRelativePath,
    };
    writeStore(store);
    return {
      status: 'renamed',
      filePath: toVirtualPresetPath('rack', nextRelativePath),
    };
  },
  createPresetFolder: async (request) => {
    const folderName = normalizePathSegment(request.folderName);
    if (!isValidPathSegment(folderName)) {
      return { status: 'error', message: 'Invalid folder name.' };
    }

    const relativePath = [...request.relativePath, folderName];
    const store = readStore();
    if (
      store.folders[request.presetType].some((path) => relativePathEquals(path, relativePath))
      || store.files.some((file) =>
        file.presetType === request.presetType && relativePathEquals(file.relativePath, relativePath))
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

    const folderName = normalizePathSegment(request.folderName);
    if (!isValidPathSegment(folderName)) {
      return { status: 'error', message: 'Invalid folder name.' };
    }

    const nextRelativePath = [...request.relativePath.slice(0, -1), folderName];
    const store = readStore();
    const folderIndex = store.folders[request.presetType].findIndex((path) =>
      relativePathEquals(path, request.relativePath));
    if (folderIndex === -1) {
      return { status: 'error', message: 'Folder does not exist.' };
    }
    if (store.folders[request.presetType].some((path) => relativePathEquals(path, nextRelativePath))) {
      return { status: 'error', message: 'An item or folder with that name already exists.' };
    }

    store.folders[request.presetType] = store.folders[request.presetType].map((path) =>
      relativePathEquals(path, request.relativePath)
        ? nextRelativePath
        : path.length > request.relativePath.length
          && relativePathEquals(path.slice(0, request.relativePath.length), request.relativePath)
            ? [...nextRelativePath, ...path.slice(request.relativePath.length)]
            : path);
    store.files = store.files.map((file) =>
      file.presetType === request.presetType
      && file.relativePath.length > request.relativePath.length
      && relativePathEquals(file.relativePath.slice(0, request.relativePath.length), request.relativePath)
        ? {
            ...file,
            relativePath: [...nextRelativePath, ...file.relativePath.slice(request.relativePath.length)],
          }
        : file);
    writeStore(store);
    return { status: 'ok', relativePath: nextRelativePath };
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
        relativePath: [] as string[],
        children: buildChildren(store, presetType, []),
      })),
    };
  },
  showPresetEntryInFolder: async () => ({ status: 'ok' }),
  showPresetsRootInFolder: async () => ({ status: 'ok' }),
  deletePresetEntry: async (request) => {
    const store = readStore();
    if (request.entryKind === 'file') {
      store.files = store.files.filter((file) =>
        file.presetType !== request.presetType || !relativePathEquals(file.relativePath, request.relativePath));
    } else {
      store.folders[request.presetType] = store.folders[request.presetType].filter((path) =>
        !relativePathEquals(path, request.relativePath)
        && !relativePathEquals(path.slice(0, request.relativePath.length), request.relativePath));
      store.files = store.files.filter((file) =>
        file.presetType !== request.presetType
        || !relativePathEquals(file.relativePath.slice(0, request.relativePath.length), request.relativePath));
    }
    writeStore(store);
    return { status: 'ok' };
  },
  readPresetEntry: async <K extends PresetFileKind>(request: {
    presetType: K;
    relativePath: string[];
  }): Promise<ReadPresetEntryResponse<K>> => {
    const store = readStore();
    const entry = store.files.find((file) =>
      file.presetType === request.presetType && relativePathEquals(file.relativePath, request.relativePath));
    if (!entry) {
      return { status: 'error', message: 'Preset does not exist.' };
    }

    return {
      status: 'loaded',
      filePath: toVirtualPresetPath(request.presetType, request.relativePath),
      payload: clonePreset(entry.payload as Extract<PresetFile, { presetType: K }>),
    };
  },
});

export const resolveCompassBridge = (): CompassApi =>
  window.compass ?? createBrowserCompassBridge();
