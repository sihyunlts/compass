import { BrowserWindow } from 'electron';
import path from 'node:path';

import { IPC_CHANNELS } from '../shared/contracts/ipc/channels';

let mainWindowRef: BrowserWindow | null = null;
let previewWindowRef: BrowserWindow | null = null;
let mainWindowCloseConfirmed = false;
let mainWindowDocumentEdited = false;
const WINDOW_BACKGROUND_COLOR = '#0d0e0f';
const PRELOAD_ENTRY_PATH = path.join(__dirname, 'preload.js');
const MAIN_RENDERER_FILE_PATH = path.join(
  __dirname,
  `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`,
);

const loadMainRenderer = (window: BrowserWindow): Promise<void> => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return window.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  }
  return window.loadFile(MAIN_RENDERER_FILE_PATH);
};

const loadPreviewRenderer = (window: BrowserWindow): Promise<void> => {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    return window.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#preview-popout`);
  }
  return window.loadFile(MAIN_RENDERER_FILE_PATH, {
    hash: 'preview-popout',
  });
};

const broadcastPreviewWindowVisibility = (): void => {
  const isOpen = !!previewWindowRef && !previewWindowRef.isDestroyed();
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) {
      continue;
    }
    window.webContents.send(IPC_CHANNELS.previewWindowVisibilityUpdate, isOpen);
  }
};

const buildMainWindowOptions = (): ConstructorParameters<typeof BrowserWindow>[0] => {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  return {
    width: 1400,
    height: 280,
    minWidth: 720,
    minHeight: 280,
    maxHeight: 280,
    fullscreenable: false,
    title: 'Compass',
    autoHideMenuBar: isWindows,
    show: false,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 12, y: 12 },
        }
      : {}),
    ...(isWindows
      ? {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: WINDOW_BACKGROUND_COLOR,
            symbolColor: '#d7dde4',
            height: 44,
          },
        }
      : {}),
    webPreferences: {
      preload: PRELOAD_ENTRY_PATH,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  };
};

/** Creates and shows the primary Compass renderer window. */
export const createMainWindow = (): BrowserWindow => {
  const mainWindow = new BrowserWindow(buildMainWindowOptions());
  mainWindow.setMenuBarVisibility(false);
  mainWindowRef = mainWindow;
  mainWindow.once('ready-to-show', () => {
    if (!mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  void loadMainRenderer(mainWindow);

  if (process.env.NODE_ENV === 'development' && !mainWindow.webContents.isDevToolsOpened()) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('close', (event) => {
    if (mainWindowCloseConfirmed) {
      return;
    }

    if (!mainWindowDocumentEdited) {
      return;
    }

    event.preventDefault();
    mainWindow.webContents.send(IPC_CHANNELS.mainWindowCloseRequest);
  });

  mainWindow.on('closed', () => {
    mainWindowCloseConfirmed = false;
    mainWindowDocumentEdited = false;
    mainWindowRef = null;
    if (previewWindowRef && !previewWindowRef.isDestroyed()) {
      previewWindowRef.close();
    }
    previewWindowRef = null;
    broadcastPreviewWindowVisibility();
  });

  return mainWindow;
};

export const isMainWindowAlwaysOnTop = (): boolean =>
  mainWindowRef?.isAlwaysOnTop() ?? false;

export const setMainWindowAlwaysOnTop = (enabled: boolean): boolean => {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) {
    return false;
  }

  mainWindowRef.setAlwaysOnTop(enabled, enabled ? 'floating' : 'normal');
  return mainWindowRef.isAlwaysOnTop();
};

const createPreviewWindow = (): BrowserWindow => {
  const parent = mainWindowRef && !mainWindowRef.isDestroyed()
    ? mainWindowRef
    : undefined;
  const previewWindow = new BrowserWindow({
    width: 480,
    height: 560,
    minWidth: 320,
    minHeight: 360,
    title: 'Compass Preview',
    show: false,
    backgroundColor: WINDOW_BACKGROUND_COLOR,
    parent,
    webPreferences: {
      preload: PRELOAD_ENTRY_PATH,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  previewWindowRef = previewWindow;
  previewWindow.once('ready-to-show', () => {
    if (!previewWindow.isDestroyed()) {
      previewWindow.show();
    }
  });
  broadcastPreviewWindowVisibility();
  void loadPreviewRenderer(previewWindow);

  if (process.env.NODE_ENV === 'development' && !previewWindow.webContents.isDevToolsOpened()) {
    previewWindow.webContents.openDevTools({ mode: 'detach' });
  }

  previewWindow.on('closed', () => {
    if (previewWindowRef === previewWindow) {
      previewWindowRef = null;
    }
    broadcastPreviewWindowVisibility();
  });

  return previewWindow;
};

/** Opens the preview popout window, or focuses the existing live instance. */
export const openPreviewWindow = (): BrowserWindow => {
  if (previewWindowRef && !previewWindowRef.isDestroyed()) {
    previewWindowRef.focus();
    return previewWindowRef;
  }

  return createPreviewWindow();
};

/** Returns the preview popout window only when the current reference is still alive. */
export const getPreviewWindow = (): BrowserWindow | null =>
  previewWindowRef && !previewWindowRef.isDestroyed() ? previewWindowRef : null;

/** Returns the main window only while the current reference is still alive. */
export const getMainWindow = (): BrowserWindow | null =>
  mainWindowRef && !mainWindowRef.isDestroyed() ? mainWindowRef : null;

export const confirmMainWindowClose = (): void => {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return;
  }

  mainWindowCloseConfirmed = true;
  mainWindow.close();
};

export const updateMainWindowDocumentState = (
  state: {
    edited: boolean;
    filePath: string | null;
  },
): void => {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return;
  }

  mainWindow.setDocumentEdited(state.edited);
  mainWindowDocumentEdited = state.edited;
  if (process.platform === 'darwin') {
    mainWindow.setRepresentedFilename(state.filePath ?? '');
  }
};

/** Returns true only while a live preview popout window reference exists. */
export const isPreviewWindowOpen = (): boolean =>
  previewWindowRef !== null && !previewWindowRef.isDestroyed();
