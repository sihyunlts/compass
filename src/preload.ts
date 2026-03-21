import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS } from './shared/contracts/ipc/channels';
import type { PresetFileKind } from './shared/presets';
import type {
  ListPresetBrowserSectionsResponse,
  OpenPresetFileRequest,
  OpenPresetFileResponse,
  ReadPresetEntryRequest,
  ReadPresetEntryResponse,
} from './shared/contracts/ipc/presets';
import type { PreviewWindowState } from './shared/contracts/preview/window-state';
import type { CompassApi } from './shared/contracts/ipc/api';
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
const previewGuideEnabledListeners = createListenerSet<boolean>();

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

ipcRenderer.on(
  IPC_CHANNELS.previewGuideEnabledUpdate,
  (_event, payload: boolean) => {
    previewGuideEnabledListeners.emit(payload === true);
  },
);

const api: CompassApi = {
  generateAndSend: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.generateAndSend, request),
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
  requestPreviewGuideEnabledUpdate: (enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.requestPreviewGuideEnabledUpdate, enabled),
  subscribePreviewWindowState: (listener) =>
    previewWindowStateListeners.subscribe(listener),
  subscribePreviewWindowVisibility: (listener) =>
    previewWindowVisibilityListeners.subscribe(listener),
  subscribePreviewGuideEnabledUpdate: (listener) =>
    previewGuideEnabledListeners.subscribe(listener),
  subscribeLiveTempo: (listener) =>
    liveTempoListeners.subscribe(listener),
  openExternal: (url) =>
    ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  savePresetFile: (request) =>
    ipcRenderer.invoke(IPC_CHANNELS.savePresetFile, request),
  listPresetBrowserSections: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listPresetBrowserSections) as Promise<ListPresetBrowserSectionsResponse>,
  readPresetEntry: <K extends PresetFileKind>(request: ReadPresetEntryRequest<K>) =>
    ipcRenderer.invoke(IPC_CHANNELS.readPresetEntry, request) as Promise<ReadPresetEntryResponse<K>>,
  openPresetFile: <K extends PresetFileKind>(request: OpenPresetFileRequest<K>) =>
    ipcRenderer.invoke(IPC_CHANNELS.openPresetFile, request) as Promise<OpenPresetFileResponse<K>>,
};

contextBridge.exposeInMainWorld('compass', api);
