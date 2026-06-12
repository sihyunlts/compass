import type { GeneratorChain } from '../../../shared/model';

type ChainDevice = GeneratorChain['devices'][number];

type MaskTileTarget = {
  grid: HTMLElement;
  deviceId: string;
  tileIndex: number;
};

interface MaskTilePaintControllerOptions {
  findDeviceById: (id: string) => ChainDevice | null;
  blurActiveTextEditingElement: () => void;
  closeContextMenu: () => void;
  scheduleAutoPreview: (delayMs?: number) => void;
  commitChange: () => void;
}

interface MaskTilePaintState {
  pointerId: number | null;
  gridEl: HTMLElement | null;
  deviceId: string | null;
  paintMode: 'add' | 'remove' | null;
  touched: Set<number>;
  didChange: boolean;
}

const createMaskTilePaintState = (): MaskTilePaintState => ({
  pointerId: null,
  gridEl: null,
  deviceId: null,
  paintMode: null,
  touched: new Set<number>(),
  didChange: false,
});

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

  const grid = tile.closest<HTMLElement>('.mask-tile-grid[data-mask-tile-grid="true"]');
  if (!grid) {
    return null;
  }

  const deviceId = grid.dataset.deviceId;
  const tileIndex = normalizeMaskTileIndex(tile.dataset.tileIndex);
  if (!deviceId || tileIndex === null) {
    return null;
  }

  return { grid, deviceId, tileIndex };
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

export class MaskTilePaintController {
  private readonly findDeviceById: (id: string) => ChainDevice | null;

  private readonly blurActiveTextEditingElement: () => void;

  private readonly closeContextMenu: () => void;

  private readonly scheduleAutoPreview: (delayMs?: number) => void;

  private readonly commitChange: () => void;

  private readonly state = createMaskTilePaintState();

  public constructor(options: MaskTilePaintControllerOptions) {
    this.findDeviceById = options.findDeviceById;
    this.blurActiveTextEditingElement = options.blurActiveTextEditingElement;
    this.closeContextMenu = options.closeContextMenu;
    this.scheduleAutoPreview = options.scheduleAutoPreview;
    this.commitChange = options.commitChange;
  }

  public isActive(): boolean {
    return this.state.pointerId !== null;
  }

  public handlePointerDown(event: PointerEvent, target: EventTarget | null): boolean {
    const hit = resolveMaskTileTarget(target);
    if (!hit) {
      return false;
    }

    const device = this.findDeviceById(hit.deviceId);
    if (!device || device.kind !== 'mask' || device.params.sourceKind !== 'tiles') {
      return false;
    }

    this.blurActiveTextEditingElement();
    this.closeContextMenu();

    this.state.pointerId = event.pointerId;
    this.state.gridEl = hit.grid;
    this.state.deviceId = hit.deviceId;
    this.state.touched = new Set<number>();
    this.state.didChange = false;
    this.state.paintMode = device.params.tiles.includes(hit.tileIndex) ? 'remove' : 'add';

    hit.grid.setPointerCapture(event.pointerId);
    if (this.applyTileChange(hit.deviceId, hit.tileIndex, this.state.paintMode)) {
      this.state.touched.add(hit.tileIndex);
      this.state.didChange = true;
      this.scheduleAutoPreview();
    }

    event.preventDefault();
    return true;
  }

  public handlePointerMove(event: PointerEvent): boolean {
    if (this.state.pointerId !== event.pointerId || !this.state.deviceId || !this.state.paintMode) {
      return false;
    }

    const hit = resolveMaskTileFromPoint(this.state, event.clientX, event.clientY);
    if (!hit || this.state.touched.has(hit.tileIndex)) {
      return true;
    }

    if (this.applyTileChange(this.state.deviceId, hit.tileIndex, this.state.paintMode)) {
      this.state.touched.add(hit.tileIndex);
      this.state.didChange = true;
      this.scheduleAutoPreview();
    }
    return true;
  }

  public handlePointerUp(event: PointerEvent): boolean {
    if (this.state.pointerId !== event.pointerId) {
      return false;
    }

    this.finish(true);
    return true;
  }

  public handlePointerCancel(event: PointerEvent): boolean {
    if (this.state.pointerId !== event.pointerId) {
      return false;
    }

    this.finish(false);
    return true;
  }

  private applyTileChange(
    deviceId: string,
    tileIndex: number,
    mode: 'add' | 'remove',
  ): boolean {
    const device = this.findDeviceById(deviceId);
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
  }

  private finish(shouldPersist: boolean): void {
    if (
      this.state.gridEl
      && this.state.pointerId !== null
      && this.state.gridEl.hasPointerCapture(this.state.pointerId)
    ) {
      this.state.gridEl.releasePointerCapture(this.state.pointerId);
    }

    if (shouldPersist && this.state.didChange) {
      this.commitChange();
    }

    this.state.pointerId = null;
    this.state.gridEl = null;
    this.state.deviceId = null;
    this.state.paintMode = null;
    this.state.touched = new Set<number>();
    this.state.didChange = false;
  }
}
