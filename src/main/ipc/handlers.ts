import { BrowserWindow, ipcMain } from 'electron';

import { IPC_CHANNELS } from '../../shared/contracts/ipc';
import type { PreviewWindowState } from '../../shared/contracts/preview';
import type { GenerateAndSendRequest } from '../../shared/contracts/ipc';
import {
  getPreviewWindow,
  isPreviewWindowOpen,
  openPreviewWindow,
} from '../app-window';
import { GeneratorService } from '../services/generator-service';

let latestPreviewWindowState: PreviewWindowState | null = null;

/** Registers Electron IPC handlers for main-only responsibilities. */
export const registerIpcHandlers = (generatorService: GeneratorService): void => {
  ipcMain.handle(
    IPC_CHANNELS.generateAndSend,
    (_event, request: GenerateAndSendRequest) =>
      generatorService.generateAndSend(request),
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
    IPC_CHANNELS.requestPreviewGuideEnabledUpdate,
    (_event, enabled: boolean) => {
      const nextEnabled = enabled === true;
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.isDestroyed()) {
          continue;
        }
        window.webContents.send(IPC_CHANNELS.previewGuideEnabledUpdate, nextEnabled);
      }
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
};
