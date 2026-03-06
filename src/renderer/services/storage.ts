import type { GeneratorChain, LaunchpadModel, PaletteFilePayload } from '../../shared/model';
import type { BridgeSettings } from '../../shared/bridge/types';
import { clamp } from '../../shared/math';
import {
  DEFAULT_BRIDGE_SETTINGS,
  sanitizeBridgeSettings,
} from '../../shared/validation/bridge-settings';
import { reconcileGeneratorChainModulators } from '../../core/modulation/routing';
import {
  createInitialChainDevices,
  syncDeviceNodeIdSeeds,
} from '../features/editor/device-node-factory';

/**
 * Renderer persistence boundary for app state stored in localStorage.
 * All loaders sanitize persisted data and fall back to safe defaults.
 */
export { sanitizeBridgeSettings };

const STATE_KEY = 'compass.state.v1';
const DEFAULT_PREVIEW_BPM = 120;
const MIN_PREVIEW_BPM = 20;
const MAX_PREVIEW_BPM = 300;
const DEFAULT_SIDEBAR_WIDTH_PX = 240;
const MIN_SIDEBAR_WIDTH_PX = 160;
const MAX_SIDEBAR_WIDTH_PX = 240;
const DEFAULT_LAUNCHPAD_MODEL: LaunchpadModel = 'mk3';

interface PersistedState {
  chain?: GeneratorChain;
  bridge?: BridgeSettings;
  preview?: {
    bpm?: number;
    loopEnabled?: boolean;
    guideEnabled?: boolean;
  };
  ui?: {
    sidebarWidthPx?: number;
    collapsedDeviceIds?: string[];
    launchpadModel?: LaunchpadModel;
  };
  palette?: {
    name?: string;
    content?: string;
  } | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readPersistedState = (): PersistedState => {
  try {
    const raw = window.localStorage.getItem(STATE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed as PersistedState : {};
  } catch {
    return {};
  }
};

const writePersistedState = (
  patch: (previous: PersistedState) => PersistedState,
): void => {
  try {
    const next = patch(readPersistedState());
    window.localStorage.setItem(STATE_KEY, JSON.stringify(next));
  } catch {
    // localStorage write failures should not block app interaction.
  }
};

const createDefaultChain = (): GeneratorChain => ({
  devices: createInitialChainDevices(),
  groupStateById: {},
});

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const toLaunchpadModel = (value: unknown): LaunchpadModel =>
  value === 'mk2' ? 'mk2' : DEFAULT_LAUNCHPAD_MODEL;

const toCollapsedDeviceIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const unique = new Set<string>();
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      unique.add(item.trim());
    }
  }

  return [...unique];
};

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
  sanitizeBridgeSettings(readPersistedState().bridge ?? DEFAULT_BRIDGE_SETTINGS);

/** Persists bridge settings after schema sanitization. */
export const saveBridgeSettings = (bridge: BridgeSettings): void => {
  writePersistedState((previous) => ({
    ...previous,
    bridge: sanitizeBridgeSettings(bridge),
  }));
};

/** Loads persisted chain state or returns defaults when stored data is malformed. */
export const loadChainSettings = (): GeneratorChain => {
  const chain = readPersistedState().chain;
  if (!chain || !Array.isArray(chain.devices) || !isRecord(chain.groupStateById)) {
    return createDefaultChain();
  }

  syncDeviceNodeIdSeeds(chain.devices);
  reconcileGeneratorChainModulators(chain);
  return chain;
};

/** Persists chain settings as provided by the renderer. */
export const saveChainSettings = (chain: GeneratorChain): void => {
  writePersistedState((previous) => ({
    ...previous,
    chain,
  }));
};

/** Loads preview BPM and clamps it to the supported renderer range. */
export const loadPreviewBpm = (): number =>
  sanitizePreviewBpm(readPersistedState().preview?.bpm ?? DEFAULT_PREVIEW_BPM);

/** Persists preview BPM after clamping to the supported renderer range. */
export const savePreviewBpm = (bpm: number): void => {
  writePersistedState((previous) => ({
    ...previous,
    preview: {
      ...previous.preview,
      bpm: sanitizePreviewBpm(bpm),
    },
  }));
};

/** Loads preview loop flag with `false` fallback for missing or invalid values. */
export const loadPreviewLoopEnabled = (): boolean =>
  toBoolean(readPersistedState().preview?.loopEnabled, false);

/** Persists preview loop flag as a strict boolean. */
export const savePreviewLoopEnabled = (enabled: boolean): void => {
  writePersistedState((previous) => ({
    ...previous,
    preview: {
      ...previous.preview,
      loopEnabled: enabled === true,
    },
  }));
};

/** Loads preview guide flag with `true` fallback for missing or invalid values. */
export const loadPreviewGuideEnabled = (): boolean =>
  toBoolean(readPersistedState().preview?.guideEnabled, true);

/** Persists preview guide flag as a strict boolean. */
export const savePreviewGuideEnabled = (enabled: boolean): void => {
  writePersistedState((previous) => ({
    ...previous,
    preview: {
      ...previous.preview,
      guideEnabled: enabled === true,
    },
  }));
};

/** Loads sidebar width and clamps it to the supported layout range. */
export const loadSidebarWidth = (): number =>
  sanitizeSidebarWidth(readPersistedState().ui?.sidebarWidthPx ?? DEFAULT_SIDEBAR_WIDTH_PX);

/** Persists sidebar width after clamping to the supported layout range. */
export const saveSidebarWidth = (width: number): void => {
  writePersistedState((previous) => ({
    ...previous,
    ui: {
      ...previous.ui,
      sidebarWidthPx: sanitizeSidebarWidth(width),
    },
  }));
};

/** Loads collapsed device IDs after trimming, deduplicating, and dropping empties. */
export const loadCollapsedDeviceIds = (): string[] =>
  toCollapsedDeviceIds(readPersistedState().ui?.collapsedDeviceIds);

/** Persists collapsed device IDs after trimming and deduplicating. */
export const saveCollapsedDeviceIds = (ids: readonly string[]): void => {
  writePersistedState((previous) => ({
    ...previous,
    ui: {
      ...previous.ui,
      collapsedDeviceIds: toCollapsedDeviceIds(ids),
    },
  }));
};

/** Loads Launchpad model with MK3 fallback for unsupported persisted values. */
export const loadLaunchpadModel = (): LaunchpadModel =>
  toLaunchpadModel(readPersistedState().ui?.launchpadModel);

/** Persists Launchpad model after coercing unsupported values to MK3. */
export const saveLaunchpadModel = (model: LaunchpadModel): void => {
  writePersistedState((previous) => ({
    ...previous,
    ui: {
      ...previous.ui,
      launchpadModel: toLaunchpadModel(model),
    },
  }));
};

/** Loads imported palette data only when persisted content is non-empty text. */
export const loadCustomPalette = (): PaletteFilePayload | null => {
  const palette = readPersistedState().palette;
  if (!palette || !isRecord(palette)) {
    return null;
  }

  const content = typeof palette.content === 'string' ? palette.content : '';
  if (!content.trim()) {
    return null;
  }

  const name = typeof palette.name === 'string' && palette.name.trim()
    ? palette.name
    : 'custom-palette';
  return { name, content };
};

/** Persists imported palette payload for reuse across renderer reloads. */
export const saveCustomPalette = (payload: PaletteFilePayload): void => {
  writePersistedState((previous) => ({
    ...previous,
    palette: {
      name: payload.name,
      content: payload.content,
    },
  }));
};

/** Removes persisted custom palette data so default palette is used on next load. */
export const clearCustomPalette = (): void => {
  writePersistedState((previous) => ({
    ...previous,
    palette: null,
  }));
};
