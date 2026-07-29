import {
  app,
  Menu,
  type MenuItemConstructorOptions,
} from 'electron';

import { getMainWindow } from './app-window';
import { IPC_CHANNELS } from '../shared/contracts/ipc/channels';
import type { RackFileMenuAction } from '../shared/contracts/ipc/api';
import {
  resolveAppLocale,
  translate,
  type AppLocale,
  type MessageKey,
} from '../shared/i18n';

const sendRackFileMenuAction = (action: RackFileMenuAction): void => {
  const mainWindow = getMainWindow();
  if (!mainWindow) {
    return;
  }

  mainWindow.webContents.send(IPC_CHANNELS.mainWindowRackFileMenuRequest, action);
};

let applicationMenuLocale: AppLocale = 'en';

const translatedRole = (
  locale: AppLocale,
  role: MenuItemConstructorOptions['role'],
  key: MessageKey,
  values?: Readonly<Record<string, string | number>>,
): MenuItemConstructorOptions => ({
  role,
  label: translate(locale, key, values),
});

const rackActionItem = (
  locale: AppLocale,
  key: MessageKey,
  accelerator: string,
  action: RackFileMenuAction,
): MenuItemConstructorOptions => ({
  label: translate(locale, key),
  accelerator,
  click: () => sendRackFileMenuAction(action),
});

const separator = (): MenuItemConstructorOptions => ({ type: 'separator' });

export const installApplicationMenu = (
  locale: AppLocale = resolveAppLocale(app.getLocale()),
): void => {
  applicationMenuLocale = locale;
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }

  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        translatedRole(locale, 'about', 'menu.aboutApp', { app: app.name }),
        separator(),
        translatedRole(locale, 'services', 'menu.services'),
        separator(),
        translatedRole(locale, 'hide', 'menu.hideApp', { app: app.name }),
        translatedRole(locale, 'hideOthers', 'menu.hideOthers'),
        translatedRole(locale, 'unhide', 'menu.showAll'),
        separator(),
        translatedRole(locale, 'quit', 'menu.quitApp', { app: app.name }),
      ],
    },
    {
      label: translate(locale, 'menu.file'),
      submenu: [
        rackActionItem(locale, 'menu.newRack', 'CommandOrControl+N', 'new'),
        separator(),
        rackActionItem(locale, 'menu.saveRack', 'CommandOrControl+S', 'save'),
        rackActionItem(
          locale,
          'menu.saveRackAs',
          'CommandOrControl+Shift+S',
          'save-as',
        ),
        separator(),
        translatedRole(locale, 'close', 'menu.closeWindow'),
      ],
    },
    {
      label: translate(locale, 'menu.edit'),
      submenu: [
        translatedRole(locale, 'undo', 'menu.undo'),
        translatedRole(locale, 'redo', 'menu.redo'),
        separator(),
        translatedRole(locale, 'cut', 'menu.cut'),
        translatedRole(locale, 'copy', 'menu.copy'),
        translatedRole(locale, 'paste', 'menu.paste'),
        translatedRole(locale, 'selectAll', 'menu.selectAll'),
      ],
    },
    {
      label: translate(locale, 'menu.view'),
      submenu: [
        translatedRole(locale, 'reload', 'menu.reload'),
        translatedRole(locale, 'forceReload', 'menu.forceReload'),
        translatedRole(locale, 'toggleDevTools', 'menu.toggleDevTools'),
        separator(),
        translatedRole(locale, 'resetZoom', 'menu.resetZoom'),
        translatedRole(locale, 'zoomIn', 'menu.zoomIn'),
        translatedRole(locale, 'zoomOut', 'menu.zoomOut'),
        separator(),
        translatedRole(locale, 'togglefullscreen', 'menu.toggleFullscreen'),
      ],
    },
    {
      label: translate(locale, 'menu.window'),
      submenu: [
        translatedRole(locale, 'minimize', 'menu.minimize'),
        translatedRole(locale, 'zoom', 'menu.zoom'),
        separator(),
        translatedRole(locale, 'front', 'menu.bringAllToFront'),
      ],
    },
  ]);

  Menu.setApplicationMenu(menu);
};

export const setApplicationMenuLocale = (locale: AppLocale): void => {
  if (locale === applicationMenuLocale) {
    return;
  }
  installApplicationMenu(locale);
};
