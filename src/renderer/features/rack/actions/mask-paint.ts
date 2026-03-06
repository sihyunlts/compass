import type { GeneratorChain } from '../../../../shared/model';

type ChainDevice = GeneratorChain['devices'][number];

type MaskTileTarget = {
  grid: HTMLElement;
  tile: HTMLElement;
  deviceId: string;
  tileIndex: number;
};

interface MaskTilePaintState {
  pointerId: number | null;
  gridEl: HTMLElement | null;
  deviceId: string | null;
  paintMode: 'add' | 'remove' | null;
  touched: Set<number>;
  didChange: boolean;
}

interface MaskTilePaintDeps {
  findDeviceById: (id: string) => ChainDevice | null;
  blurActiveTextEditingElement: () => void;
  closeContextMenu: () => void;
  scheduleAutoPreview: (delayMs?: number) => void;
}

export const createMaskTilePaintState = (): MaskTilePaintState => ({
  pointerId: null,
  gridEl: null,
  deviceId: null,
  paintMode: null,
  touched: new Set<number>(),
  didChange: false,
});

export const isMaskTilePaintActive = (state: MaskTilePaintState): boolean =>
  state.pointerId !== null;

export const isMaskTilePointer = (
  state: MaskTilePaintState,
  pointerId: number,
): boolean => state.pointerId === pointerId;

const normalizeMaskTileIndex = (
  rawIndex: string | number | undefined,
): number | null => {
  const numeric = Number(rawIndex);
  if (!Number.isFinite(numeric) || !Number.isInteger(numeric)) {
    return null;
  }
  if (numeric < 0 || numeric > 99) {
    return null;
  }
  return numeric;
};

const resolveMaskTileTarget = (
  target: EventTarget | null,
): MaskTileTarget | null => {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  const tile = target.closest<HTMLElement>('.mask-tile[data-tile-index]');
  if (!tile) {
    return null;
  }

  const grid = tile.closest<HTMLElement>('.mask-tile-grid[data-action="mask-tile-grid"]');
  if (!grid) {
    return null;
  }

  const deviceId = grid.dataset.id;
  const tileIndex = normalizeMaskTileIndex(tile.dataset.tileIndex);
  if (!deviceId || tileIndex === null) {
    return null;
  }

  return { grid, tile, deviceId, tileIndex };
};

const resolveMaskTileFromPoint = (
  state: MaskTilePaintState,
  clientX: number,
  clientY: number,
): { tileIndex: number } | null => {
  const element = document.elementFromPoint(clientX, clientY);
  if (!element) {
    return null;
  }

  const hit = resolveMaskTileTarget(element);
  if (!hit || hit.grid !== state.gridEl) {
    return null;
  }

  return { tileIndex: hit.tileIndex };
};

const applyMaskTileChange = (
  findDeviceById: (id: string) => ChainDevice | null,
  deviceId: string,
  tileIndex: number,
  mode: 'add' | 'remove',
): boolean => {
  const device = findDeviceById(deviceId);
  if (!device || device.kind !== 'mask') {
    return false;
  }

  const tiles = new Set<number>(device.params.tiles);
  const hasTile = tiles.has(tileIndex);
  if (mode === 'add') {
    if (hasTile) {
      return false;
    }
    tiles.add(tileIndex);
  } else {
    if (!hasTile) {
      return false;
    }
    tiles.delete(tileIndex);
  }

  device.params.tiles = [...tiles].sort((a, b) => a - b);
  return true;
};

export const tryStartMaskTilePaint = (
  state: MaskTilePaintState,
  event: PointerEvent,
  target: HTMLElement,
  deps: MaskTilePaintDeps,
): boolean => {
  const hit = resolveMaskTileTarget(target);
  if (!hit) {
    return false;
  }

  const device = deps.findDeviceById(hit.deviceId);
  if (!device || device.kind !== 'mask' || device.params.sourceKind !== 'tiles') {
    return false;
  }

  deps.blurActiveTextEditingElement();
  deps.closeContextMenu();

  state.pointerId = event.pointerId;
  state.gridEl = hit.grid;
  state.deviceId = hit.deviceId;
  state.touched = new Set<number>();
  state.didChange = false;

  const shouldRemove = device.params.tiles.includes(hit.tileIndex);
  state.paintMode = shouldRemove ? 'remove' : 'add';

  hit.grid.setPointerCapture(event.pointerId);
  if (applyMaskTileChange(deps.findDeviceById, hit.deviceId, hit.tileIndex, state.paintMode)) {
    state.touched.add(hit.tileIndex);
    state.didChange = true;
    deps.scheduleAutoPreview();
  }

  event.preventDefault();
  return true;
};

export const applyMaskTileFromPoint = (
  state: MaskTilePaintState,
  clientX: number,
  clientY: number,
  findDeviceById: (id: string) => ChainDevice | null,
): boolean => {
  if (!state.deviceId || !state.paintMode) {
    return false;
  }

  const hit = resolveMaskTileFromPoint(state, clientX, clientY);
  if (!hit) {
    return false;
  }

  if (state.touched.has(hit.tileIndex)) {
    return false;
  }

  const changed = applyMaskTileChange(findDeviceById, state.deviceId, hit.tileIndex, state.paintMode);
  if (changed) {
    state.touched.add(hit.tileIndex);
  }
  return changed;
};

export const clearMaskTilePointerState = (
  state: MaskTilePaintState,
  persist: boolean,
  onPersist: () => void,
): void => {
  if (
    state.gridEl
    && state.pointerId !== null
    && state.gridEl.hasPointerCapture(state.pointerId)
  ) {
    state.gridEl.releasePointerCapture(state.pointerId);
  }

  if (persist && state.didChange) {
    onPersist();
  }

  state.pointerId = null;
  state.gridEl = null;
  state.deviceId = null;
  state.paintMode = null;
  state.touched = new Set<number>();
  state.didChange = false;
};
