import {
  getLaunchpadRuntimeMap,
  resolveLaunchpadModel,
  type OverlayFrameStroke,
} from '../../../domain';
import { clamp } from '../../../shared/math';
import type {
  LaunchpadButton,
  LaunchpadModel,
  PreviewWindowState,
} from '../../../shared/types';
import { toPreviewFrameIndex } from '../../services/preview-cache';

const PREVIEW_COLS = 10;
const PREVIEW_ROWS = 10;
const PREVIEW_LED_GAMMA = 0.3;
const PREVIEW_LED_PAD_FLOOR = 50;
const OVERLAY_WORLD_BASE_PADDING = 4;

export interface OverlayWorldBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface PreviewSurfaceCellModel {
  key: string;
  pitches: number[];
  isEdgeButton: boolean;
  isCornerPlaceholder: boolean;
}

export interface PreviewSurfaceViewModel {
  launchpadModel: LaunchpadModel;
  cells: ReadonlyArray<PreviewSurfaceCellModel>;
  activeCells: ReadonlyArray<PreviewWindowState['activeCells'][number]>;
  overlayStrokes: ReadonlyArray<OverlayFrameStroke>;
  overlayWorldBounds: OverlayWorldBounds;
  isGuideEnabled: boolean;
}

const previewCellCache = new Map<LaunchpadModel, ReadonlyArray<PreviewSurfaceCellModel>>();

const cellKey = (row: number, col: number): string => `${row}:${col}`;

const buttonToPreviewCell = (
  button: LaunchpadButton,
): { row: number; col: number } | null => {
  switch (button.zone) {
    case 'grid':
      return { row: 9 - button.y, col: button.x };
    case 'left':
      if (button.id === 'left-top') {
        return { row: 0, col: 0 };
      }
      return { row: 9 - button.y, col: 0 };
    case 'right':
      return { row: 9 - button.y, col: 9 };
    case 'top':
      return { row: 0, col: button.x };
    case 'bottom':
      return { row: 9, col: button.x };
    case 'logo':
      return { row: 0, col: 9 };
    default:
      return null;
  }
};

const isCornerPlaceholderCell = (
  buttons: ReadonlyArray<LaunchpadButton>,
): boolean => {
  if (buttons.length !== 1) {
    return false;
  }
  const [button] = buttons;
  return button.id === 'bottom-corner-left'
    || button.id === 'bottom-corner-right'
    || button.id === 'left-top'
    || button.id === 'logo';
};

const isEdgeButtonCell = (
  buttons: ReadonlyArray<LaunchpadButton>,
): boolean => buttons.some((button) =>
  button.zone === 'left'
  || button.zone === 'right'
  || button.zone === 'top'
  || button.zone === 'bottom'
  || button.zone === 'logo');

const toNoteNumber = (button: LaunchpadButton): number | null =>
  button.output.kind === 'note' ? button.output.number : null;

const parseRgbChannels = (rgb: string): [number, number, number] | null => {
  const values = rgb
    .trim()
    .split(/\s+/)
    .map((value) => Number(value));
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return [
    Math.round(clamp(values[0], 0, 255)),
    Math.round(clamp(values[1], 0, 255)),
    Math.round(clamp(values[2], 0, 255)),
  ];
};

const applyPreviewLedGamma = (channel: number): number =>
  Math.pow(clamp(channel, 0, 255) / 255, PREVIEW_LED_GAMMA) * 255;

export const resolveOverlayWorldBounds = (padding: number): OverlayWorldBounds => ({
  minX: 0 - padding,
  maxX: 9 + padding,
  minY: 0 - padding,
  maxY: 9 + padding,
});

export const DEFAULT_OVERLAY_WORLD_BOUNDS = resolveOverlayWorldBounds(
  OVERLAY_WORLD_BASE_PADDING,
);

export const resolvePreviewSourceTimelineEndBeat = (
  state: PreviewWindowState | null,
): number => {
  const endBeat = state?.sourceTimelineEndBeat;
  return Number.isFinite(endBeat) && endBeat > 0 ? endBeat : 1;
};

export const resolvePreviewCellModels = (
  model?: LaunchpadModel,
): ReadonlyArray<PreviewSurfaceCellModel> => {
  const resolvedModel = resolveLaunchpadModel(model);
  const cached = previewCellCache.get(resolvedModel);
  if (cached) {
    return cached;
  }

  const buttons = getLaunchpadRuntimeMap(resolvedModel).buttons;
  const buttonsByCell = new Map<string, LaunchpadButton[]>();

  for (const button of buttons) {
    if (button.output.kind !== 'note') {
      continue;
    }

    const cell = buttonToPreviewCell(button);
    if (!cell) {
      continue;
    }

    const key = cellKey(cell.row, cell.col);
    const list = buttonsByCell.get(key);
    if (list) {
      list.push(button);
      continue;
    }
    buttonsByCell.set(key, [button]);
  }

  const cells: PreviewSurfaceCellModel[] = [];
  for (let row = 0; row < PREVIEW_ROWS; row += 1) {
    for (let col = 0; col < PREVIEW_COLS; col += 1) {
      const key = cellKey(row, col);
      const cellButtons = buttonsByCell.get(key) ?? [];
      const pitches: number[] = [];
      for (const button of cellButtons) {
        const note = toNoteNumber(button);
        if (note !== null) {
          pitches.push(note);
        }
      }
      cells.push({
        key,
        pitches,
        isEdgeButton: isEdgeButtonCell(cellButtons),
        isCornerPlaceholder: isCornerPlaceholderCell(cellButtons),
      });
    }
  }

  previewCellCache.set(resolvedModel, cells);
  return cells;
};

/**
 * Approximates the brighter pad surface color instead of the bare LED color.
 * Keeps fully-off LEDs black so velocity 0 still reads as unlit.
 */
export const resolvePreviewSurfaceRgb = (rgb: string): string => {
  const channels = parseRgbChannels(rgb);
  if (!channels) {
    return rgb;
  }

  const [r, g, b] = channels;
  if (r === 0 && g === 0 && b === 0) {
    return '0 0 0';
  }

  const liftChannel = (channel: number): number => Math.round(Math.min(
    255,
    (PREVIEW_LED_PAD_FLOOR * (1 - (channel / 255))) + (applyPreviewLedGamma(channel) * 1.1),
  ));

  return `${liftChannel(r)} ${liftChannel(g)} ${liftChannel(b)}`;
};

export const createEmptyPreviewSurfaceViewModel = (
  model?: LaunchpadModel,
): PreviewSurfaceViewModel => {
  const resolvedModel = resolveLaunchpadModel(model);
  return {
    launchpadModel: resolvedModel,
    cells: resolvePreviewCellModels(resolvedModel),
    activeCells: [],
    overlayStrokes: [],
    overlayWorldBounds: DEFAULT_OVERLAY_WORLD_BOUNDS,
    isGuideEnabled: false,
  };
};

export const buildPreviewSurfaceViewModel = (
  previewState: PreviewWindowState | null,
  overlayFramesByIndex: ReadonlyArray<ReadonlyArray<OverlayFrameStroke>>,
  overlayWorldBounds: OverlayWorldBounds,
): PreviewSurfaceViewModel => {
  const resolvedModel = resolveLaunchpadModel(previewState?.launchpadModel);
  const sourceTimelineEndBeat = resolvePreviewSourceTimelineEndBeat(previewState);
  const overlayStrokes = previewState && previewState.isGuideEnabled !== false
    ? (overlayFramesByIndex[toPreviewFrameIndex(
        previewState.currentBeat,
        sourceTimelineEndBeat,
      )] ?? [])
    : [];

  return {
    launchpadModel: resolvedModel,
    cells: resolvePreviewCellModels(resolvedModel),
    activeCells: (previewState?.activeCells ?? []).map((cell) => ({
      pitch: cell.pitch,
      rgb: resolvePreviewSurfaceRgb(cell.rgb),
    })),
    overlayStrokes,
    overlayWorldBounds,
    isGuideEnabled: previewState?.isGuideEnabled !== false,
  };
};
