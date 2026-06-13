import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS } from './shared/contracts/ipc/channels';
import type { PresetFileKind } from './shared/presets';
import type {
  CreatePresetFolderRequest,
  CreatePresetFolderResponse,
  DeletePresetEntryRequest,
  DeletePresetEntryResponse,
  ListPresetBrowserTreeResponse,
  ReadPresetEntryRequest,
  ReadPresetEntryResponse,
  RenameRackFileRequest,
  RenameRackFileResponse,
  RenamePresetFolderRequest,
  RenamePresetFolderResponse,
  ShowPresetEntryInFolderRequest,
  ShowPresetEntryInFolderResponse,
  ShowPresetsRootInFolderResponse,
} from './shared/contracts/ipc/presets';
import type { PreviewWindowState } from './shared/contracts/preview/window-state';
import type {
  CompassApi,
  MainWindowDocumentState,
  RackFileMenuAction,
} from './shared/contracts/ipc/api';
import type { LiveTempoUpdate } from './shared/bridge/types';

interface ListenerSet<T> {
  emit: (payload: T) => void;
  subscribe: (listener: (payload: T) => void) => () => void;
}

const createListenerSet = <T>(): ListenerSet<T> => {
  const listeners = new Set<(payload: T) => void>();

  return {
    emit: (payload: T): void => {
      for (const listener of listeners) {
        try {
          listener(payload);
        } catch {
          // Keep bridge dispatch alive even when one renderer listener throws.
        }
      }
    },
    subscribe: (listener: (payload: T) => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const liveTempoListeners = createListenerSet<LiveTempoUpdate>();
const previewWindowStateListeners = createListenerSet<PreviewWindowState>();
const previewWindowVisibilityListeners = createListenerSet<boolean>();
const mainWindowCloseRequestListeners = createListenerSet<void>();
const mainWindowRackFileMenuRequestListeners = createListenerSet<RackFileMenuAction>();

ipcRenderer.on(IPC_CHANNELS.liveTempoUpdate, (_event, payload: LiveTempoUpdate) => {
  liveTempoListeners.emit(payload);
});

ipcRenderer.on(
  IPC_CHANNELS.previewWindowStateUpdate,
  (_event, payload: PreviewWindowState) => {
    previewWindowStateListeners.emit(payload);
  },
);

ipcRenderer.on(
  IPC_CHANNELS.previewWindowVisibilityUpdate,
  (_event, payload: boolean) => {
    previewWindowVisibilityListeners.emit(payload === true);
  },
);

ipcRenderer.on(IPC_CHANNELS.mainWindowCloseRequest, () => {
  mainWindowCloseRequestListeners.emit();
});

ipcRenderer.on(
  IPC_CHANNELS.mainWindowRackFileMenuRequest,
  (_event, action: RackFileMenuAction) => {
    if (action === 'new' || action === 'save' || action === 'save-as') {
      mainWindowRackFileMenuRequestListeners.emit(action);
    }
  },
);

const api: CompassApi = {
  sendGeneratedPreview: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.sendGeneratedPreview, request),
  requestAppVersion: () =>
    ipcRenderer.invoke(IPC_CHANNELS.requestAppVersion),
  requestLiveTempo: () =>
    ipcRenderer.invoke(IPC_CHANNELS.requestLiveTempo),
  openPreviewWindow: () =>
    ipcRenderer.invoke(IPC_CHANNELS.openPreviewWindow),
  pushPreviewWindowState: (state) => {
    ipcRenderer.send(IPC_CHANNELS.pushPreviewWindowState, state);
  },
  requestPreviewWindowState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.requestPreviewWindowState),
  requestPreviewWindowVisibility: () =>
    ipcRenderer.invoke(IPC_CHANNELS.requestPreviewWindowVisibility),
  subscribePreviewWindowState: (listener) =>
    previewWindowStateListeners.subscribe(listener),
  subscribePreviewWindowVisibility: (listener) =>
    previewWindowVisibilityListeners.subscribe(listener),
  subscribeMainWindowCloseRequest: (listener) =>
    mainWindowCloseRequestListeners.subscribe(listener),
  subscribeMainWindowRackFileMenuRequest: (listener) =>
    mainWindowRackFileMenuRequestListeners.subscribe(listener),
  requestMainWindowAlwaysOnTop: () =>
    ipcRenderer.invoke(IPC_CHANNELS.requestMainWindowAlwaysOnTop) as Promise<boolean>,
  setMainWindowAlwaysOnTop: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.setMainWindowAlwaysOnTop, enabled) as Promise<boolean>,
  confirmMainWindowClose: () =>
    ipcRenderer.invoke(IPC_CHANNELS.confirmMainWindowClose),
  pushMainWindowDocumentState: (state: MainWindowDocumentState) => {
    ipcRenderer.send(IPC_CHANNELS.pushMainWindowDocumentState, state);
  },
  subscribeLiveTempo: (listener) =>
    liveTempoListeners.subscribe(listener),
  openExternal: (url) =>
    ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  savePresetFile: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.savePresetFile, request),
  saveRackFile: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveRackFile, request),
  renameRackFile: (request: RenameRackFileRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameRackFile, request) as Promise<RenameRackFileResponse>,
  createPresetFolder: (request: CreatePresetFolderRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.createPresetFolder, request) as Promise<CreatePresetFolderResponse>,
  renamePresetFolder: (request: RenamePresetFolderRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.renamePresetFolder, request) as Promise<RenamePresetFolderResponse>,
  listPresetBrowserTree: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listPresetBrowserTree) as Promise<ListPresetBrowserTreeResponse>,
  showPresetEntryInFolder: (request: ShowPresetEntryInFolderRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.showPresetEntryInFolder, request) as Promise<ShowPresetEntryInFolderResponse>,
  showPresetsRootInFolder: () =>
    ipcRenderer.invoke(IPC_CHANNELS.showPresetsRootInFolder) as Promise<ShowPresetsRootInFolderResponse>,
  deletePresetEntry: (request: DeletePresetEntryRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.deletePresetEntry, request) as Promise<DeletePresetEntryResponse>,
  readPresetEntry: <K extends PresetFileKind>(request: ReadPresetEntryRequest<K>) =>
    ipcRenderer.invoke(IPC_CHANNELS.readPresetEntry, request) as Promise<ReadPresetEntryResponse<K>>,
};

contextBridge.exposeInMainWorld('compass', api);
