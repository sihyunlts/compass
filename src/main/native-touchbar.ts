import { app, type BrowserWindow } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';

import { getLaunchpadRuntimeMap } from '../domain';
import {
  buildLaunchpadPreviewCellIndexByPitch,
  LAUNCHPAD_PREVIEW_GRID_COLUMNS,
  LAUNCHPAD_PREVIEW_GRID_ROWS,
} from '../shared/launchpad-preview-grid';
import { resolveLedSurfaceRgbChannels } from '../shared/led-surface-color';
import {
  AUTO_CREATE_LENGTH_OPTIONS,
  toLengthPresetLabel,
} from '../shared/beat-length';
import type { PreviewWindowControlRequest } from '../shared/contracts/ipc/api';
import { IPC_CHANNELS } from '../shared/contracts/ipc/channels';
import {
  PREVIEW_SCRUB_MAX,
  resolvePreviewScrubValue,
  type PreviewTimelineFrameStrip,
  type PreviewWindowState,
} from '../shared/contracts/preview/window-state';
import {
  translate,
  type AppLocale,
} from '../shared/i18n';

interface NativeTouchBarLabels {
  play: string;
  pause: string;
  enableLoop: string;
  disableLoop: string;
  duration: string;
  send: string;
}

interface NativeTouchBarState {
  isPlaying: boolean;
  isLoopEnabled: boolean;
  scrubValue: number;
  duration: string;
}

interface NativeTouchBarAddon {
  install: (
    nativeViewHandle: Buffer,
    onAction: (action: string, value?: unknown) => void,
    labels: NativeTouchBarLabels,
    durationOptions: string[],
    scrubMax: number,
  ) => void;
  update: (state: NativeTouchBarState) => void;
  setTimelineFrames: (
    data: Buffer,
    frameCount: number,
    columns: number,
    rows: number,
  ) => void;
  setCurrentFrame: (
    data: Buffer,
    columns: number,
    rows: number,
  ) => void;
  setLabels: (labels: NativeTouchBarLabels) => void;
  dispose: () => void;
}

const nativeRequire = createRequire(__filename);

let nativeAddon: NativeTouchBarAddon | null | undefined;
let activeWindow: BrowserWindow | null = null;
let currentLocale: AppLocale = 'en';
let latestPreviewState: PreviewWindowState | null = null;
let latestTimelineFrames: PreviewTimelineFrameStrip | null = null;

const buildLabels = (): NativeTouchBarLabels => ({
  play: translate(currentLocale, 'preview.playAria'),
  pause: translate(currentLocale, 'preview.pauseAria'),
  enableLoop: translate(currentLocale, 'preview.enableLoop'),
  disableLoop: translate(currentLocale, 'preview.disableLoop'),
  duration: translate(currentLocale, 'preview.length'),
  send: translate(currentLocale, 'status.send'),
});

const loadNativeAddon = (): NativeTouchBarAddon | null => {
  if (process.platform !== 'darwin') {
    return null;
  }

  if (nativeAddon !== undefined) {
    return nativeAddon;
  }

  const addonRoot = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked')
    : app.getAppPath();
  const addonPath = path.join(
    addonRoot,
    'native',
    'macos',
    'build',
    'Release',
    'compass_touchbar.node',
  );

  try {
    nativeAddon = nativeRequire(addonPath) as NativeTouchBarAddon;
  } catch (error) {
    nativeAddon = null;
    console.warn('Native Touch Bar module is unavailable:', error);
  }

  return nativeAddon;
};

const sendControlRequest = (request: PreviewWindowControlRequest): void => {
  const window = activeWindow;
  if (!window || window.isDestroyed()) {
    return;
  }

  window.webContents.send(
    IPC_CHANNELS.previewWindowControlRequest,
    request,
  );
};

const handleNativeAction = (
  action: string,
  value?: unknown,
): void => {
  if (action === 'play') {
    sendControlRequest({ action: 'toggle-playback' });
    return;
  }

  if (action === 'loop') {
    sendControlRequest({ action: 'toggle-loop' });
    return;
  }

  if (action === 'send') {
    sendControlRequest({ action: 'deliver' });
    return;
  }

  if (
    action === 'seek'
    && typeof value === 'number'
    && Number.isFinite(value)
  ) {
    sendControlRequest({
      action: 'seek',
      scrubValue: Math.round(
        Math.max(0, Math.min(PREVIEW_SCRUB_MAX, value)),
      ),
    });
    return;
  }

  if (
    action === 'duration'
    && typeof value === 'string'
    && AUTO_CREATE_LENGTH_OPTIONS.some((option) => option.label === value)
  ) {
    sendControlRequest({
      action: 'set-duration',
      label: value,
    });
  }
};

const pushTimelineFramesToNative = (
  addon: NativeTouchBarAddon,
  frames: PreviewTimelineFrameStrip,
): void => {
  addon.setTimelineFrames(
    Buffer.from(
      frames.data.buffer,
      frames.data.byteOffset,
      frames.data.byteLength,
    ),
    frames.frameCount,
    frames.columns,
    frames.rows,
  );
};

const touchBarCellIndexByPitchCache =
  new Map<string, ReadonlyMap<number, number>>();

const resolveTouchBarCellIndexByPitch = (
  state: PreviewWindowState,
): ReadonlyMap<number, number> => {
  const key = state.launchpadModel ?? 'default';
  const cached = touchBarCellIndexByPitchCache.get(key);
  if (cached) {
    return cached;
  }

  const indexByPitch = buildLaunchpadPreviewCellIndexByPitch(
    getLaunchpadRuntimeMap(state.launchpadModel).buttons,
  );

  touchBarCellIndexByPitchCache.set(key, indexByPitch);
  return indexByPitch;
};

const packCurrentTouchBarFrame = (
  state: PreviewWindowState,
): Buffer => {
  const data = Buffer.alloc(
    LAUNCHPAD_PREVIEW_GRID_COLUMNS * LAUNCHPAD_PREVIEW_GRID_ROWS * 3,
  );
  const indexByPitch = resolveTouchBarCellIndexByPitch(state);

  for (const activeCell of state.activeCells) {
    const cellIndex = indexByPitch.get(activeCell.pitch);
    if (cellIndex === undefined) {
      continue;
    }

    const rgb = resolveLedSurfaceRgbChannels(activeCell.rgb);
    if (!rgb) {
      continue;
    }

    const [red, green, blue] = rgb;
    if (red === 0 && green === 0 && blue === 0) {
      continue;
    }

    const offset = cellIndex * 3;
    data[offset] = red;
    data[offset + 1] = green;
    data[offset + 2] = blue;
  }

  return data;
};

const pushCurrentFrameToNative = (
  addon: NativeTouchBarAddon,
  state: PreviewWindowState,
): void => {
  addon.setCurrentFrame(
    packCurrentTouchBarFrame(state),
    LAUNCHPAD_PREVIEW_GRID_COLUMNS,
    LAUNCHPAD_PREVIEW_GRID_ROWS,
  );
};

const syncStateToNative = (
  addon: NativeTouchBarAddon,
  state: PreviewWindowState,
): void => {
  pushCurrentFrameToNative(addon, state);
  addon.update({
    isPlaying: state.isPlaying,
    isLoopEnabled: state.isLoopEnabled,
    scrubValue: resolvePreviewScrubValue(state),
    duration: toLengthPresetLabel(state.loopLengthBeats, '1/4'),
  });
};

export const installMainWindowNativeTouchBar = (
  mainWindow: BrowserWindow,
): void => {
  if (process.platform !== 'darwin') {
    return;
  }

  const addon = loadNativeAddon();
  if (!addon) {
    return;
  }

  activeWindow = mainWindow;

  try {
    addon.install(
      mainWindow.getNativeWindowHandle(),
      handleNativeAction,
      buildLabels(),
      AUTO_CREATE_LENGTH_OPTIONS.map((option) => option.label),
      PREVIEW_SCRUB_MAX,
    );

    if (latestTimelineFrames) {
      pushTimelineFramesToNative(addon, latestTimelineFrames);
    }

    if (latestPreviewState) {
      syncStateToNative(addon, latestPreviewState);
    }
  } catch (error) {
    activeWindow = null;
    console.warn('Failed to install native Touch Bar:', error);
  }
};

export const setMainWindowNativeTouchBarLocale = (
  locale: AppLocale,
): void => {
  currentLocale = locale;
  nativeAddon?.setLabels(buildLabels());
};

export const updateMainWindowNativeTouchBarState = (
  state: PreviewWindowState,
): void => {
  if (process.platform !== 'darwin') {
    return;
  }

  latestPreviewState = state;
  if (state.timelineFrameStrip) {
    latestTimelineFrames = state.timelineFrameStrip;
  }

  if (nativeAddon) {
    if (state.timelineFrameStrip) {
      pushTimelineFramesToNative(nativeAddon, state.timelineFrameStrip);
    }
    syncStateToNative(nativeAddon, state);
  }
};

export const disposeMainWindowNativeTouchBar = (): void => {
  nativeAddon?.dispose();
  activeWindow = null;
  latestPreviewState = null;
  latestTimelineFrames = null;
};
