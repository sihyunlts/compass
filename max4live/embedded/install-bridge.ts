import { createRendererHostBridge } from '../../src/renderer/app/renderer-host-bridge';
import { GITHUB_LATEST_RELEASE_URL } from '../../src/shared/releases/github';
import { createMaxFileBridge } from './file-client';
import { createMaxLiveBridge } from './live-client';
import type { MaxWebApi } from './web-api';

const max = (window as Window & { max?: MaxWebApi }).max;
if (!max) throw new Error('Open this build inside the Compass Max for Live device.');

// CEF's Chromium 103 branch still has no permission controller; 104 adds it.
// https://github.com/chromiumembedded/cef/blob/5112/libcef/browser/alloy/alloy_browser_context.cc
const chromiumMajorVersion = Number(/\b(?:Chrome|Chromium)\/(\d+)/u.exec(navigator.userAgent)?.[1]);
const supportsHardwareMidi = chromiumMajorVersion >= 104 && typeof navigator.requestMIDIAccess === 'function';
const openExternal = async (url: string): Promise<void> => {
  const destination = new URL(url);
  if (destination.protocol !== 'https:' && destination.protocol !== 'http:') {
    throw new Error('Only HTTP and HTTPS links can be opened externally.');
  }
  max.outlet('compass_open_external', destination.href);
};

window.compass = {
  ...createRendererHostBridge(),
  ...createMaxFileBridge(max),
  ...createMaxLiveBridge(max),
  runtime: 'max-for-live',
  supportsHardwareMidi,
  // This embedded build deliberately has no network access.
  checkForUpdates: async () => ({
    status: 'unavailable', currentVersion: __APP_VERSION__, message: 'Update checks are unavailable in Max for Live.',
  }),
  openExternal,
  openLatestReleasePage: () => openExternal(GITHUB_LATEST_RELEASE_URL),
};
