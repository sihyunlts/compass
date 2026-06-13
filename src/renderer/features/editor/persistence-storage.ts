import type { BridgeSettings } from '../../../shared/bridge/types';
import {
  type GeneratorChain,
  type LaunchpadModel,
} from '../../../shared/model';
import { clamp } from '../../../shared/math';
import {
  DEFAULT_BRIDGE_SETTINGS,
  sanitizeBridgeSettings,
} from '../../../shared/validation/bridge-settings';
import {
  readPersistedRendererState,
  writePersistedRendererState,
} from '../../persisted-state';
import {
  createInitialChainDevices,
  syncDeviceNodeIdSeeds,
} from './device-node-factory';

/** Editor persistence boundary for renderer localStorage-backed state. */

const DEFAULT_PREVIEW_BPM = 120;
const MIN_PREVIEW_BPM = 20;
const MAX_PREVIEW_BPM = 300;
const DEFAULT_SIDEBAR_WIDTH_PX = 240;
const MIN_SIDEBAR_WIDTH_PX = 160;
const MAX_SIDEBAR_WIDTH_PX = 240;
const DEFAULT_LAUNCHPAD_MODEL: LaunchpadModel = 'mk3';

const createDefaultChain = (): GeneratorChain => ({
  name: null,
  devices: createInitialChainDevices(),
  groupStateById: {},
});

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const toLaunchpadModel = (value: unknown): LaunchpadModel =>
  value === 'mk2' ? 'mk2' : DEFAULT_LAUNCHPAD_MODEL;

/** Clamps preview BPM to the supported renderer range. */
export const sanitizePreviewBpm = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_PREVIEW_BPM;
  }

  return Number(clamp(numeric, MIN_PREVIEW_BPM, MAX_PREVIEW_BPM).toFixed(2));
};

/** Clamps sidebar width to the supported layout range. */
export const sanitizeSidebarWidth = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return DEFAULT_SIDEBAR_WIDTH_PX;
  }

  return Math.round(clamp(numeric, MIN_SIDEBAR_WIDTH_PX, MAX_SIDEBAR_WIDTH_PX));
};

/** Loads persisted bridge settings and applies schema defaults/sanitization. */
export const loadBridgeSettings = (): BridgeSettings =>
  sanitizeBridgeSettings(readPersistedRendererState().bridge ?? DEFAULT_BRIDGE_SETTINGS);

/** Persists bridge settings after schema sanitization. */
export const saveBridgeSettings = (bridge: BridgeSettings): void => {
  writePersistedRendererState({
    bridge: sanitizeBridgeSettings(bridge),
  });
};

/** Creates the default rack shown when the app starts. */
export const createDefaultChainSettings = (): GeneratorChain => {
  const chain = createDefaultChain();
  syncDeviceNodeIdSeeds(chain.devices);
  return chain;
};

/** Loads preview BPM and clamps it to the supported renderer range. */
export const loadPreviewBpm = (): number =>
  sanitizePreviewBpm(readPersistedRendererState().preview?.bpm ?? DEFAULT_PREVIEW_BPM);

/** Persists preview BPM after clamping to the supported renderer range. */
export const savePreviewBpm = (bpm: number): void => {
  writePersistedRendererState({
    preview: {
      bpm: sanitizePreviewBpm(bpm),
    },
  });
};

/** Loads preview loop flag with `false` fallback for missing or invalid values. */
export const loadPreviewLoopEnabled = (): boolean =>
  toBoolean(readPersistedRendererState().preview?.loopEnabled, false);

/** Persists preview loop flag as a strict boolean. */
export const savePreviewLoopEnabled = (enabled: boolean): void => {
  writePersistedRendererState({
    preview: {
      loopEnabled: enabled === true,
    },
  });
};

/** Loads sidebar width and clamps it to the supported layout range. */
export const loadSidebarWidth = (): number =>
  sanitizeSidebarWidth(readPersistedRendererState().ui?.sidebarWidthPx ?? DEFAULT_SIDEBAR_WIDTH_PX);

/** Persists sidebar width after clamping to the supported layout range. */
export const saveSidebarWidth = (width: number): void => {
  writePersistedRendererState({
    ui: {
      sidebarWidthPx: sanitizeSidebarWidth(width),
    },
  });
};

/** Loads Launchpad model with MK3 fallback for unsupported persisted values. */
export const loadLaunchpadModel = (): LaunchpadModel =>
  toLaunchpadModel(readPersistedRendererState().ui?.launchpadModel);

/** Persists Launchpad model after coercing unsupported values to MK3. */
export const saveLaunchpadModel = (model: LaunchpadModel): void => {
  writePersistedRendererState({
    ui: {
      launchpadModel: toLaunchpadModel(model),
    },
  });
};

/** Loads the main window layer pin flag with `false` fallback for missing or invalid values. */
export const loadMainWindowAlwaysOnTop = (): boolean =>
  toBoolean(readPersistedRendererState().ui?.mainWindowAlwaysOnTop, false);

/** Persists the main window layer pin flag as a strict boolean. */
export const saveMainWindowAlwaysOnTop = (enabled: boolean): void => {
  writePersistedRendererState({
    ui: {
      mainWindowAlwaysOnTop: enabled === true,
    },
  });
};
