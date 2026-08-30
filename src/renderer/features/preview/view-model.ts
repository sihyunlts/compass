import {
  getLaunchpadRuntimeMap,
  resolveLaunchpadModel,
} from '../../../domain';
import type { LaunchpadButton, LaunchpadModel } from '../../../shared/model';
import type { PreviewWindowState } from '../../../shared/contracts/preview/window-state';
import { buildLaunchpadPreviewGridCells } from '../../../shared/launchpad-preview-grid';
import { resolveLedSurfaceRgb } from '../../app/led-surface-color';

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
}

const previewCellCache = new Map<LaunchpadModel, ReadonlyArray<PreviewSurfaceCellModel>>();

export const resolvePreviewCenterCornerCutClassName = (
  previewCellKey: string,
): string => {
  if (previewCellKey === '4:4') {
    return 'is-center-corner-bottom-right';
  }
  if (previewCellKey === '4:5') {
    return 'is-center-corner-bottom-left';
  }
  if (previewCellKey === '5:4') {
    return 'is-center-corner-top-right';
  }
  if (previewCellKey === '5:5') {
    return 'is-center-corner-top-left';
  }
  return '';
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

export const resolvePreviewCellModels = (
  model?: LaunchpadModel,
): ReadonlyArray<PreviewSurfaceCellModel> => {
  const resolvedModel = resolveLaunchpadModel(model);
  const cached = previewCellCache.get(resolvedModel);
  if (cached) {
    return cached;
  }

  const cells = buildLaunchpadPreviewGridCells(
    getLaunchpadRuntimeMap(resolvedModel).buttons,
  ).map<PreviewSurfaceCellModel>((cell) => ({
    key: cell.key,
    pitches: [...cell.pitches],
    isEdgeButton: isEdgeButtonCell(cell.buttons),
    isCornerPlaceholder: isCornerPlaceholderCell(cell.buttons),
  }));

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
