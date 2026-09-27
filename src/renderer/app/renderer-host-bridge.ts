import type { CompassApi } from '../../shared/contracts/ipc/api';
import { resolveShortcutPlatform } from '../../shared/keyboard-shortcuts';

// Browser and Max share document focus and lack Electron's native window APIs.
type RendererHostApi = Pick<CompassApi,
  | 'platform'
  | 'requestAppVersion'
  | 'setApplicationLocale'
  | 'requestAppFocus'
  | 'subscribeAppFocus'
  | 'performHapticFeedback'
  | 'openPreviewWindow'
  | 'sendPreviewWindowControlRequest'
  | 'pushPreviewWindowState'
  | 'requestPreviewWindowState'
  | 'requestPreviewWindowVisibility'
  | 'subscribePreviewWindowState'
  | 'subscribePreviewWindowVisibility'
  | 'subscribePreviewWindowControlRequest'
  | 'subscribeMainWindowCloseRequest'
  | 'subscribeMainWindowRackFileMenuRequest'
  | 'requestMainWindowAlwaysOnTop'
  | 'setMainWindowAlwaysOnTop'
  | 'confirmMainWindowClose'
  | 'pushMainWindowDocumentState'
  | 'getPathForFile'
>;

const createNoopSubscription = (): (() => void) => () => {};

export const createRendererHostBridge = (): RendererHostApi => ({
  platform: resolveShortcutPlatform(navigator.userAgent),
  requestAppVersion: async () => __APP_VERSION__,
  setApplicationLocale: async () => {},
  requestAppFocus: async () => document.hasFocus(),
  subscribeAppFocus: (listener) => {
    const handleFocus = (): void => listener(true);
    const handleBlur = (): void => listener(false);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  },
  performHapticFeedback: () => {},
  openPreviewWindow: async () => {
    throw new Error('Preview popout is only available in the Electron app.');
  },
  sendPreviewWindowControlRequest: () => {},
  pushPreviewWindowState: () => {},
  requestPreviewWindowState: async () => null,
  requestPreviewWindowVisibility: async () => false,
  subscribePreviewWindowState: createNoopSubscription,
  subscribePreviewWindowVisibility: createNoopSubscription,
  subscribePreviewWindowControlRequest: createNoopSubscription,
  subscribeMainWindowCloseRequest: createNoopSubscription,
  subscribeMainWindowRackFileMenuRequest: createNoopSubscription,
  requestMainWindowAlwaysOnTop: async () => false,
  setMainWindowAlwaysOnTop: async () => false,
  confirmMainWindowClose: async () => {},
  pushMainWindowDocumentState: () => {},
  getPathForFile: () => null,
});
