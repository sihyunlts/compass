import { app, Menu } from 'electron';

import { getMainWindow } from './app-window';
import { IPC_CHANNELS } from '../shared/contracts/ipc/channels';
import type { RackFileMenuAction } from '../shared/contracts/ipc/api';

const sendRackFileMenuAction = (action: RackFileMenuAction): void => {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return;
  }

  mainWindow.webContents.send(IPC_CHANNELS.mainWindowRackFileMenuRequest, action);
};

export const installApplicationMenu = (): void => {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New Rack',
          accelerator: 'CommandOrControl+N',
          click: () => sendRackFileMenuAction('new'),
        },
        { type: 'separator' },
        {
          label: 'Save Rack',
          accelerator: 'CommandOrControl+S',
          click: () => sendRackFileMenuAction('save'),
        },
        {
          label: 'Save Rack As...',
          accelerator: 'CommandOrControl+Shift+S',
          click: () => sendRackFileMenuAction('save-as'),
        },
        { type: 'separator' },
        { role: 'close' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
};
