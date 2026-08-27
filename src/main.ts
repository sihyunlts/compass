import { app, BrowserWindow, session, type WebContents } from 'electron';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import {
  createMainWindow,
  getMainWindow,
  getPreviewWindow,
  isCompassRendererUrl,
} from './main/app-window';
import { installApplicationMenu } from './main/application-menu';
import { LiveTempoListener } from './main/bridge/live-tempo-listener';
import { registerIpcHandlers } from './main/ipc/handlers';
import { GeneratorService } from './main/services/generator-service';
import { PresetService } from './main/services/preset-service';
import { UpdateCheckService } from './main/services/update-check-service';
import { IPC_CHANNELS } from './shared/contracts/ipc/channels';

const WINDOWS_APP_USER_MODEL_ID = 'com.sihyunlights.compass';
const COMPASS_PERMISSIONS = new Set(['midi', 'midiSysex', 'pointerLock']);

const isCompassWindow = (webContents: WebContents | null): boolean =>
  webContents !== null
  && [getMainWindow(), getPreviewWindow()].some(
    (window) => window?.webContents === webContents,
  );

const canUseCompassPermission = (
  webContents: WebContents | null,
  permission: string,
  requestingUrl: string,
  isMainFrame: boolean,
): boolean => COMPASS_PERMISSIONS.has(permission)
  && isMainFrame
  && isCompassWindow(webContents)
  && isCompassRendererUrl(requestingUrl);

const configureCompassPermissions = (): void => {
  const appSession = session.defaultSession;
  appSession.setPermissionCheckHandler((
    webContents,
    permission,
    requestingOrigin,
    details,
  ) => canUseCompassPermission(
    webContents,
    permission,
    details.requestingUrl ?? requestingOrigin,
    details.isMainFrame,
  ));
  appSession.setPermissionRequestHandler((
    webContents,
    permission,
    callback,
    details,
  ) => {
    callback(canUseCompassPermission(
      webContents,
      permission,
      details.requestingUrl,
      details.isMainFrame,
    ));
  });
};

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

let appFocusBroadcastTimer: NodeJS.Timeout | null = null;

const broadcastAppFocus = (): void => {
  if (appFocusBroadcastTimer) {
    clearTimeout(appFocusBroadcastTimer);
  }
  appFocusBroadcastTimer = setTimeout(() => {
    appFocusBroadcastTimer = null;
    sendToAllWindows(
      IPC_CHANNELS.appFocusUpdate,
      BrowserWindow.getFocusedWindow() !== null,
    );
  }, 0);
};

const focusOrCreateMainWindow = (): void => {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    createMainWindow();
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
  mainWindow.focus();
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

const startApplication = (): void => {
  const generatorService = new GeneratorService();
  const presetService = new PresetService();
  const updateCheckService = new UpdateCheckService();
  const liveTempoListener = new LiveTempoListener();
  registerIpcHandlers(generatorService, presetService, updateCheckService);

  app.on('second-instance', focusOrCreateMainWindow);
  app.on('browser-window-focus', broadcastAppFocus);
  app.on('browser-window-blur', broadcastAppFocus);

  app.whenReady().then(() => {
    configureCompassPermissions();
    installApplicationMenu();

    liveTempoListener.start((update) => {
      sendToAllWindows(IPC_CHANNELS.liveTempoUpdate, update);
    });
    void presetService.startWatchingBrowserTree(() => {
      sendToAllWindows(IPC_CHANNELS.presetBrowserTreeChanged, undefined);
    });

    focusOrCreateMainWindow();
    app.on('activate', focusOrCreateMainWindow);
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  app.on('will-quit', () => {
    if (appFocusBroadcastTimer) {
      clearTimeout(appFocusBroadcastTimer);
      appFocusBroadcastTimer = null;
    }
    presetService.stopWatchingBrowserTree();
    liveTempoListener.stop();
  });
};

if (!handleSquirrelStartupEvent()) {
  if (app.requestSingleInstanceLock()) {
    startApplication();
  } else {
    app.quit();
  }
}
