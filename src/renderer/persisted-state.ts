import type { BridgeSettings } from '../shared/bridge/types';
import type {
  GeneratorChain,
  LaunchpadModel,
} from '../shared/model';

export const RENDERER_STATE_KEY = 'compass.state.v1';

export interface PersistedRendererState {
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

type PersistedRendererStatePatch = {
  chain?: GeneratorChain;
  bridge?: BridgeSettings;
  preview?: PersistedRendererState['preview'];
  ui?: PersistedRendererState['ui'];
  palette?: PersistedRendererState['palette'];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const mergeRecordSection = <T extends Record<string, unknown>>(
  previous: T | undefined,
  next: T | undefined,
): T | undefined => {
  if (!next) {
    return previous;
  }

  return {
    ...(previous ?? {}),
    ...next,
  };
};

const mergePersistedRendererState = (
  previous: PersistedRendererState,
  patch: PersistedRendererStatePatch,
): PersistedRendererState => ({
  ...previous,
  ...(patch.chain !== undefined ? { chain: patch.chain } : {}),
  ...(patch.bridge !== undefined ? { bridge: patch.bridge } : {}),
  ...(patch.preview !== undefined
    ? { preview: mergeRecordSection(previous.preview, patch.preview) }
    : {}),
  ...(patch.ui !== undefined
    ? { ui: mergeRecordSection(previous.ui, patch.ui) }
    : {}),
  ...(patch.palette !== undefined
    ? {
        palette: patch.palette === null
          ? null
          : mergeRecordSection(
            previous.palette && isRecord(previous.palette) ? previous.palette : undefined,
            patch.palette,
          ),
      }
    : {}),
});

/** Reads the shared renderer state document from localStorage. */
export const readPersistedRendererState = (): PersistedRendererState => {
  try {
    const raw = window.localStorage.getItem(RENDERER_STATE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed as PersistedRendererState : {};
  } catch {
    return {};
  }
};

/**
 * Writes a partial update into the shared renderer state document.
 * Merge rules: top-level sections replace atomically except `preview`, `ui`, and object `palette`,
 * which are shallow-merged with the existing section; `palette: null` clears the stored palette.
 */
export const writePersistedRendererState = (
  patch: PersistedRendererStatePatch,
): void => {
  try {
    const next = mergePersistedRendererState(readPersistedRendererState(), patch);
    window.localStorage.setItem(RENDERER_STATE_KEY, JSON.stringify(next));
  } catch {
    // localStorage write failures should not block app interaction.
  }
};
