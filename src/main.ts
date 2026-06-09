import { app, BrowserWindow } from 'electron';
import path from 'node:path';

import { createMainWindow } from './main/app-window';
import { LiveTempoListener } from './main/bridge/live-tempo-listener';
import { registerIpcHandlers } from './main/ipc/handlers';
import { GeneratorService } from './main/services/generator-service';
import { PresetService } from './main/services/preset-service';
import { IPC_CHANNELS } from './shared/contracts/ipc/channels';

const generatorService = new GeneratorService();
const presetService = new PresetService();
const liveTempoListener = new LiveTempoListener();
registerIpcHandlers(generatorService, presetService);

const sendToAllWindows = <T>(channel: string, payload: T): void => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  }
};

const resolveDevUserDataPath = (): string | null => {
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }
  const appData = app.getPath('appData');
  return path.join(appData, 'compass-dev');
};

const devUserDataPath = resolveDevUserDataPath();
if (devUserDataPath) {
  app.setPath('userData', devUserDataPath);
}

app.whenReady().then(() => {
  liveTempoListener.start((update) => {
    sendToAllWindows(IPC_CHANNELS.liveTempoUpdate, update);
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  liveTempoListener.stop();
});
