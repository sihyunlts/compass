import { app, BrowserWindow, ipcMain, shell } from 'electron';

import { IPC_CHANNELS } from '../../shared/contracts/ipc/channels';
import type { PreviewWindowState } from '../../shared/contracts/preview/window-state';
import type { GenerateAndSendRequest } from '../../shared/contracts/ipc/generator';
import {
  getMainWindow,
  getPreviewWindow,
  isPreviewWindowOpen,
  openPreviewWindow,
} from '../app-window';
import { GeneratorService } from '../services/generator-service';
import { PresetService } from '../services/preset-service';

let latestPreviewWindowState: PreviewWindowState | null = null;

const resolveDialogParentWindow = () => getMainWindow() ?? BrowserWindow.getFocusedWindow() ?? undefined;

/** Registers Electron IPC handlers for main-only responsibilities. */
export const registerIpcHandlers = (
  generatorService: GeneratorService,
  presetService: PresetService,
): void => {
  ipcMain.handle(
    IPC_CHANNELS.generateAndSend,
    (_event, request: GenerateAndSendRequest) =>
      generatorService.generateAndSend(request),
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
