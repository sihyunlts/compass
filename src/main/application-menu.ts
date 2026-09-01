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
import {
  resolveElectronAccelerator,
  resolveShortcutPlatform,
  type AppShortcutId,
} from '../shared/keyboard-shortcuts';

const shortcutPlatform = resolveShortcutPlatform(process.platform);

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

const translatedShortcutRole = (
  locale: AppLocale,
  role: MenuItemConstructorOptions['role'],
  key: MessageKey,
  shortcutId: AppShortcutId,
): MenuItemConstructorOptions => ({
  ...translatedRole(locale, role, key),
  accelerator: resolveElectronAccelerator(shortcutId, shortcutPlatform),
});

const rackActionItem = (
  locale: AppLocale,
  key: MessageKey,
  shortcutId: AppShortcutId,
  action: RackFileMenuAction,
): MenuItemConstructorOptions => ({
  label: translate(locale, key),
  accelerator: resolveElectronAccelerator(shortcutId, shortcutPlatform),
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
        rackActionItem(locale, 'menu.newRack', 'newRack', 'new'),
        separator(),
        rackActionItem(locale, 'menu.saveRack', 'saveRack', 'save'),
        rackActionItem(
          locale,
          'menu.saveRackAs',
          'saveRackAs',
          'save-as',
        ),
        separator(),
        translatedRole(locale, 'close', 'menu.closeWindow'),
      ],
    },
    {
      label: translate(locale, 'menu.edit'),
      submenu: [
        translatedShortcutRole(locale, 'undo', 'menu.undo', 'undo'),
        translatedShortcutRole(locale, 'redo', 'menu.redo', 'redo'),
        separator(),
        translatedShortcutRole(locale, 'cut', 'menu.cut', 'cut'),
        translatedShortcutRole(locale, 'copy', 'menu.copy', 'copy'),
        translatedShortcutRole(locale, 'paste', 'menu.paste', 'paste'),
        translatedShortcutRole(locale, 'selectAll', 'menu.selectAll', 'selectAll'),
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
