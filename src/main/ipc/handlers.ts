import { app, BrowserWindow, ipcMain, shell } from 'electron';

import { IPC_CHANNELS } from '../../shared/contracts/ipc/channels';
import type { PreviewWindowState } from '../../shared/contracts/preview/window-state';
import type { SendGeneratedPreviewRequest } from '../../shared/contracts/ipc/generator';
import type { MainWindowDocumentState } from '../../shared/contracts/ipc/api';
import {
  getMainWindow,
  getPreviewWindow,
  confirmMainWindowClose,
  isMainWindowAlwaysOnTop,
  isPreviewWindowOpen,
  openPreviewWindow,
  setMainWindowAlwaysOnTop,
  updateMainWindowDocumentState,
} from '../app-window';
import { GeneratorService } from '../services/generator-service';
import { PresetService } from '../services/preset-service';

let latestPreviewWindowState: PreviewWindowState | null = null;

const resolveDialogParentWindow = () => getMainWindow() ?? BrowserWindow.getFocusedWindow() ?? undefined;

const parseMainWindowDocumentState = (
  value: unknown,
): MainWindowDocumentState | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const edited = (value as { edited?: unknown }).edited;
  const filePath = (value as { filePath?: unknown }).filePath;
  if (typeof edited !== 'boolean') {
    return null;
  }

  let normalizedFilePath: string | null;
  if (filePath === null) {
    normalizedFilePath = null;
  } else if (typeof filePath === 'string') {
    normalizedFilePath = filePath;
  } else {
    return null;
  }

  return {
    edited,
    filePath: normalizedFilePath,
  };
};

/** Registers Electron IPC handlers for main-only responsibilities. */
export const registerIpcHandlers = (
  generatorService: GeneratorService,
  presetService: PresetService,
): void => {
  ipcMain.handle(
    IPC_CHANNELS.sendGeneratedPreview,
    (_event, request: SendGeneratedPreviewRequest) =>
      generatorService.sendGeneratedPreview(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.requestAppVersion,
    () => app.getVersion(),
  );

  ipcMain.handle(
    IPC_CHANNELS.requestLiveTempo,
    () =>
      generatorService.requestLiveTempo(),
  );

  ipcMain.handle(IPC_CHANNELS.openPreviewWindow, () => {
    const previewWindow = openPreviewWindow();
    if (!latestPreviewWindowState) {
      return;
    }

    const sendState = (): void => {
      previewWindow.webContents.send(
        IPC_CHANNELS.previewWindowStateUpdate,
        latestPreviewWindowState,
      );
    };

    if (previewWindow.webContents.isLoadingMainFrame()) {
      previewWindow.webContents.once('did-finish-load', sendState);
      return;
    }

    sendState();
  });

  ipcMain.handle(
    IPC_CHANNELS.requestPreviewWindowState,
    () => latestPreviewWindowState,
  );

  ipcMain.handle(
    IPC_CHANNELS.requestPreviewWindowVisibility,
    () => isPreviewWindowOpen(),
  );

  ipcMain.handle(
    IPC_CHANNELS.confirmMainWindowClose,
    () => confirmMainWindowClose(),
  );

  ipcMain.handle(
    IPC_CHANNELS.requestMainWindowAlwaysOnTop,
    () => isMainWindowAlwaysOnTop(),
  );

  ipcMain.handle(
    IPC_CHANNELS.setMainWindowAlwaysOnTop,
    (_event, enabled: unknown) => setMainWindowAlwaysOnTop(enabled === true),
  );

  ipcMain.on(
    IPC_CHANNELS.pushMainWindowDocumentState,
    (_event, state) => {
      const parsedState = parseMainWindowDocumentState(state);
      if (!parsedState) {
        return;
      }

      updateMainWindowDocumentState(parsedState);
    },
  );

  ipcMain.on(
    IPC_CHANNELS.pushPreviewWindowState,
    (_event, state: PreviewWindowState) => {
      latestPreviewWindowState = state;
      const previewWindow = getPreviewWindow();
      if (!previewWindow) {
        return;
      }

      previewWindow.webContents.send(IPC_CHANNELS.previewWindowStateUpdate, state);
    },
  );

  ipcMain.handle(IPC_CHANNELS.openExternal, (_event, url: string) => {
    void shell.openExternal(url);
  });

  ipcMain.handle(
    IPC_CHANNELS.savePresetFile,
    (_event, request) =>
      presetService.savePresetFile(request, resolveDialogParentWindow()),
  );

  ipcMain.handle(
    IPC_CHANNELS.saveRackFile,
    (_event, request) =>
      presetService.saveRackFile(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.renameRackFile,
    (_event, request) =>
      presetService.renameRackFile(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.createPresetFolder,
    (_event, request) =>
      presetService.createPresetFolder(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.renamePresetFolder,
    (_event, request) =>
      presetService.renamePresetFolder(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.listPresetBrowserTree,
    () =>
      presetService.listPresetBrowserTree(),
  );

  ipcMain.handle(
    IPC_CHANNELS.showPresetEntryInFolder,
    (_event, request) =>
      presetService.showPresetEntryInFolder(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.showPresetsRootInFolder,
    () =>
      presetService.showPresetsRootInFolder(),
  );

  ipcMain.handle(
    IPC_CHANNELS.deletePresetEntry,
    (_event, request) =>
      presetService.deletePresetEntry(request),
  );

  ipcMain.handle(
    IPC_CHANNELS.readPresetEntry,
    (_event, request) =>
      presetService.readPresetEntry(request),
  );
};
