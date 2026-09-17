import { getRendererDeviceLabel } from '../../devices/registry-core';
import { buildBundledRackPresetCollectionNode } from '../../shared/preset/bundled-racks';
import {
  DEVICE_BROWSER_CATEGORY_DEFINITIONS,
  resolveDeviceBrowserSystemDirectoryPath,
} from '../../devices/browser-categories';

import { type PresetEntryMovePlan } from '../../shared/preset/entry-move';
import {
  arePresetPathsEqual as relativePathEquals,
  doPresetPathsCollide as relativePathCollides,
  isPresetPathInside as relativePathContains,
  type PresetEntryPath,
  type PresetEntrySelectionItem,
} from '../../shared/preset/entry-selection';
import type {
  PresetBrowserTreeFolderNode,
  PresetBrowserTreeNode,
  ReadPresetEntryResponse,
} from '../../shared/contracts/ipc/presets';
import {
  isPresetFileKind,
  parseStoredPresetValue,
  resolvePresetBrowserPreview,
  resolvePresetNameFromFileName,
  type PresetFile,
  type PresetFileKind,
} from '../../shared/preset/file';
import type {
  PresetRepositoryBackend,
  PresetRepositoryStorage,
} from '../../shared/preset/repository-backend';

const STORAGE_KEY = 'compass:web-bridge:preset-store:v1';
const VIRTUAL_PRESET_ROOT = 'browser://presets';
export const ROOT_LABELS: Record<PresetFileKind, string> = {
  device: 'Devices',
  group: 'Groups',
  rack: 'Racks',
};
export const presetBrowserTreeChangedListeners = new Set<() => void>();

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

const createEmptyStore = (): BrowserPresetStore => ({
  folders: {
    device: DEVICE_BROWSER_CATEGORY_DEFINITIONS.flatMap((category) => [
      [category.directoryName],
      ...category.deviceKinds.map((kind) => [category.directoryName, getRendererDeviceLabel(kind)]),
    ]),
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

export const parseVirtualPresetPath = (
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
      throw new Error('Invalid browser preset store.');
    }

    const store = createEmptyStore();
    for (const presetType of Object.keys(store.folders) as PresetFileKind[]) {
      const rawFolders = parsed.folders[presetType];
      const savedFolders = Array.isArray(rawFolders)
        ? rawFolders.filter((path): path is string[] =>
            Array.isArray(path) && path.every((segment) => typeof segment === 'string'))
        : [];
      for (const folder of savedFolders) {
        if (!store.folders[presetType].some((path) => relativePathCollides(path, folder))) {
          store.folders[presetType].push(folder);
        }
      }
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
  } catch (error) {
    throw new Error('Failed to read browser presets. Stored data has not been replaced.', { cause: error });
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

const storageFor = (store: BrowserPresetStore): PresetRepositoryStorage => {
  const ensureEntry = async (entry: PresetEntrySelectionItem): Promise<void> => {
    if (entry.entryKind === 'directory' && entry.relativePath.length === 0) return;
    if (!hasStoreEntry(store, entry)) throw new Error('Preset item does not exist or its type has changed.');
  };
  const ensureDestination = async (presetType: PresetFileKind, relativePath: readonly string[], create: boolean): Promise<void> => {
    for (let depth = 1; depth <= relativePath.length; depth += 1) {
      const folder = relativePath.slice(0, depth);
      if (store.files.some((file) => file.presetType === presetType && relativePathCollides(file.relativePath, folder))) {
        throw new Error('Destination is not a folder.');
      }
      if (!store.folders[presetType].some((path) => relativePathEquals(path, folder))) {
        if (!create) throw new Error('Destination folder does not exist.');
        store.folders[presetType].push(folder);
      }
    }
  };
  return {
    location: async (entry) => toVirtualPresetPath(entry.presetType, entry.relativePath),
    listOccupiedPaths: async (presetType) => collectStorePaths(store).filter((entry) => entry.presetType === presetType),
    ensureEntry,
    read: async <K extends PresetFileKind>(entry: PresetEntryPath & { presetType: K }): Promise<ReadPresetEntryResponse<K>> => {
      const file = store.files.find((file) => file.presetType === entry.presetType && relativePathEquals(file.relativePath, entry.relativePath));
      if (!file) return { status: 'error', errorCode: 'preset-not-found', message: 'Preset does not exist.' };
      return { status: 'loaded', filePath: toVirtualPresetPath(entry.presetType, entry.relativePath),
        payload: clonePreset(file.payload as Extract<PresetFile, { presetType: K }>), needsSave: file.needsSave };
    },
    createFolder: async (entry) => { store.folders[entry.presetType].push([...entry.relativePath]); },
    rename: async (entry, relativePath) => {
      mapStoreEntryPaths(store, entry.presetType, (path, kind) => applyMovePlansToPath(path, kind, [{ entry, relativePath, isNoop: false }]));
    },
    update: async (entry, relativePath, updatePayload) => {
      const index = store.files.findIndex((file) => file.presetType === entry.presetType && relativePathEquals(file.relativePath, entry.relativePath));
      if (index === -1) throw new Error('Preset does not exist.');
      store.files[index] = { ...store.files[index], relativePath, payload: updatePayload(store.files[index].payload), needsSave: false };
    },
    write: async (entry, payload) => {
      const index = store.files.findIndex((file) => file.presetType === entry.presetType && relativePathEquals(file.relativePath, entry.relativePath));
      const file = { presetType: entry.presetType, relativePath: [...entry.relativePath], payload: clonePreset(payload), needsSave: false };
      if (index === -1) store.files.push(file);
      else store.files[index] = file;
    },
    revision: async (entry) => {
      const file = store.files.find((file) => file.presetType === entry.presetType && relativePathEquals(file.relativePath, entry.relativePath));
      return file ? JSON.stringify(file) : null;
    },
    move: async (presetType, plans, destination, createDestination) => {
      for (const { entry } of plans) await ensureEntry(entry);
      await ensureDestination(presetType, destination, createDestination);
      mapStoreEntryPaths(store, presetType, (path, kind) => applyMovePlansToPath(path, kind, plans));
    },
    copy: async (presetType, plans) => {
      for (const plan of plans) {
        await ensureEntry(plan.entry);
        const parent = plan.relativePath.slice(0, -1);
        await ensureDestination(presetType, parent, presetType === 'device' && resolveDeviceBrowserSystemDirectoryPath(parent) !== null);
      }
      const sourceFolders = [...store.folders[presetType]];
      const sourceFiles = [...store.files];
      for (const plan of plans) {
        if (plan.entry.entryKind === 'directory') {
          for (const folder of sourceFolders) {
            if (relativePathContains(plan.entry.relativePath, folder)) store.folders[presetType].push([...plan.relativePath, ...folder.slice(plan.entry.relativePath.length)]);
          }
        }
        for (const file of sourceFiles) {
          if (file.presetType === presetType && (plan.entry.entryKind === 'directory'
            ? relativePathContains(plan.entry.relativePath, file.relativePath) : relativePathEquals(plan.entry.relativePath, file.relativePath))) {
            store.files.push({ ...file, relativePath: [...plan.relativePath, ...file.relativePath.slice(plan.entry.relativePath.length)], payload: clonePreset(file.payload) });
          }
        }
      }
    },
    delete: async (entries) => {
      for (const entry of entries) {
        if (entry.entryKind === 'directory') store.folders[entry.presetType] = store.folders[entry.presetType].filter((path) => !relativePathContains(entry.relativePath, path));
        store.files = store.files.filter((file) => file.presetType !== entry.presetType || !(entry.entryKind === 'directory'
          ? relativePathContains(entry.relativePath, file.relativePath) : relativePathEquals(entry.relativePath, file.relativePath)));
      }
    },
  };
};

export class BrowserPresetBackend implements PresetRepositoryBackend {
  private queue: Promise<unknown> = Promise.resolve();

  public get storage(): PresetRepositoryStorage { return storageFor(readStore()); }

  public async listTree() {
    const store = readStore();
    return {
      tree: (['device', 'group', 'rack'] as const).map((presetType): PresetBrowserTreeFolderNode => ({
        kind: 'folder', id: `preset-root:${presetType}`, label: ROOT_LABELS[presetType], presetType,
        source: 'user', relativePath: [], children: presetType === 'rack'
          ? [buildBundledRackPresetCollectionNode(), ...buildChildren(store, presetType, [])] : buildChildren(store, presetType, []),
      })),
      occupiedPaths: collectStorePaths(store),
    };
  }

  public mutate<T>(operation: (storage: PresetRepositoryStorage) => Promise<T>): Promise<T> {
    const execute = async (): Promise<T> => {
      const store = readStore();
      const before = JSON.stringify(store);
      const result = await operation(storageFor(store));
      if (JSON.stringify(store) !== before) writeStore(store);
      return result;
    };
    // Web Locks also serialize edits made by other tabs on the same origin.
    const result = this.queue.then(async () => await navigator.locks.request(STORAGE_KEY, execute));
    this.queue = result.catch((): void => undefined);
    return result;
  }
}
