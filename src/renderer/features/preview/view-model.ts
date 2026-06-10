import {
  getLaunchpadRuntimeMap,
  resolveLaunchpadModel,
} from '../../../domain';
import type { LaunchpadButton, LaunchpadModel } from '../../../shared/model';
import type { PreviewWindowState } from '../../../shared/contracts/preview/window-state';
import { resolveLedSurfaceRgb } from '../../app/led-surface-color';

const PREVIEW_COLS = 10;
const PREVIEW_ROWS = 10;

interface PreviewSurfaceCellModel {
  key: string;
  pitches: number[];
  isEdgeButton: boolean;
  isCornerPlaceholder: boolean;
}

export interface PreviewSurfaceViewModel {
  launchpadModel: LaunchpadModel;
  cells: ReadonlyArray<PreviewSurfaceCellModel>;
  activeCells: ReadonlyArray<PreviewWindowState['activeCells'][number]>;
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

const resolvePreviewCellModels = (
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

export const createEmptyPreviewSurfaceViewModel = (
  model?: LaunchpadModel,
): PreviewSurfaceViewModel => {
  const resolvedModel = resolveLaunchpadModel(model);
  return {
    launchpadModel: resolvedModel,
    cells: resolvePreviewCellModels(resolvedModel),
    activeCells: [],
  };
};

export const buildPreviewSurfaceViewModel = (
  previewState: PreviewWindowState | null,
): PreviewSurfaceViewModel => {
  const resolvedModel = resolveLaunchpadModel(previewState?.launchpadModel);

  return {
    launchpadModel: resolvedModel,
    cells: resolvePreviewCellModels(resolvedModel),
    activeCells: (previewState?.activeCells ?? []).map((cell) => ({
      pitch: cell.pitch,
      rgb: resolveLedSurfaceRgb(cell.rgb),
    })),
  };
};
