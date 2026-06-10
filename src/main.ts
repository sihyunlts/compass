import { app, BrowserWindow } from 'electron';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { createMainWindow } from './main/app-window';
import { installApplicationMenu } from './main/application-menu';
import { LiveTempoListener } from './main/bridge/live-tempo-listener';
import { registerIpcHandlers } from './main/ipc/handlers';
import { GeneratorService } from './main/services/generator-service';
import { PresetService } from './main/services/preset-service';
import { IPC_CHANNELS } from './shared/contracts/ipc/channels';

const WINDOWS_APP_USER_MODEL_ID = 'com.sihyunlights.compass';

const handleSquirrelStartupEvent = (): boolean => {
  if (process.platform !== 'win32') {
    return false;
  }

  const squirrelEvent = process.argv[1];
  if (!squirrelEvent?.startsWith('--squirrel-')) {
    return false;
  }

  const updateExePath = path.resolve(path.dirname(process.execPath), '..', 'Update.exe');
  const exeName = path.basename(process.execPath);
  const runUpdate = (args: string[]): void => {
    spawnSync(updateExePath, args, {
      stdio: 'ignore',
      windowsHide: true,
    });
  };

  if (squirrelEvent === '--squirrel-install' || squirrelEvent === '--squirrel-updated') {
    runUpdate(['--createShortcut', exeName]);
  }

  if (squirrelEvent === '--squirrel-uninstall') {
    runUpdate(['--removeShortcut', exeName]);
  }

  app.quit();
  return true;
};

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

if (process.platform === 'win32') {
  app.setAppUserModelId(WINDOWS_APP_USER_MODEL_ID);
}

if (!handleSquirrelStartupEvent()) {
  const generatorService = new GeneratorService();
  const presetService = new PresetService();
  const liveTempoListener = new LiveTempoListener();
  registerIpcHandlers(generatorService, presetService);

  app.whenReady().then(() => {
    installApplicationMenu();

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
    app.quit();
  });

  app.on('will-quit', () => {
    liveTempoListener.stop();
  });
}
