import type { BridgeSettings } from '../shared/bridge/types';
import type { LaunchpadModel } from '../shared/model';

const RENDERER_STATE_KEY = 'compass.state.v1';

export interface PersistedRendererState {
  bridge?: BridgeSettings;
  preview?: {
    bpm?: number;
    loopEnabled?: boolean;
  };
  ui?: {
    sidebarWidthPx?: number;
    launchpadModel?: LaunchpadModel;
    mainWindowAlwaysOnTop?: boolean;
  };
  palette?: {
    name?: string;
    content?: string;
  } | null;
}

type PersistedRendererStatePatch = {
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

const pickPersistedPreview = (
  preview: PersistedRendererState['preview'],
): PersistedRendererState['preview'] | undefined => {
  if (!preview) {
    return undefined;
  }

  return {
    ...(preview.bpm !== undefined ? { bpm: preview.bpm } : {}),
    ...(preview.loopEnabled !== undefined ? { loopEnabled: preview.loopEnabled } : {}),
  };
};

const pickPersistedUi = (
  ui: PersistedRendererState['ui'],
): PersistedRendererState['ui'] | undefined => {
  if (!ui) {
    return undefined;
  }

  return {
    ...(ui.sidebarWidthPx !== undefined ? { sidebarWidthPx: ui.sidebarWidthPx } : {}),
    ...(ui.launchpadModel !== undefined ? { launchpadModel: ui.launchpadModel } : {}),
    ...(ui.mainWindowAlwaysOnTop !== undefined
      ? { mainWindowAlwaysOnTop: ui.mainWindowAlwaysOnTop }
      : {}),
  };
};

const pickPersistedPalette = (
  palette: PersistedRendererState['palette'],
): PersistedRendererState['palette'] => {
  if (palette === null || palette === undefined) {
    return palette;
  }

  return {
    ...(palette.name !== undefined ? { name: palette.name } : {}),
    ...(palette.content !== undefined ? { content: palette.content } : {}),
  };
};

const mergePersistedRendererState = (
  previous: PersistedRendererState,
  patch: PersistedRendererStatePatch,
): PersistedRendererState => {
  const preview = pickPersistedPreview(previous.preview);
  const ui = pickPersistedUi(previous.ui);
  const palette = pickPersistedPalette(previous.palette);

  return {
    ...(previous.bridge !== undefined ? { bridge: previous.bridge } : {}),
    ...(preview !== undefined ? { preview } : {}),
    ...(ui !== undefined ? { ui } : {}),
    ...(palette !== undefined ? { palette } : {}),
    ...(patch.bridge !== undefined ? { bridge: patch.bridge } : {}),
    ...(patch.preview !== undefined
      ? { preview: mergeRecordSection(preview, patch.preview) }
      : {}),
    ...(patch.ui !== undefined
      ? { ui: mergeRecordSection(ui, patch.ui) }
      : {}),
    ...(patch.palette !== undefined
      ? {
          palette: patch.palette === null
            ? null
            : mergeRecordSection(
              palette && isRecord(palette) ? palette : undefined,
              patch.palette,
            ),
        }
      : {}),
  };
};

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
