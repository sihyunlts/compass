import type { GeneratorChain } from '../../../shared/model';
import { PointerCaptureSession } from './pointer-capture-session';

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
  requestTransientPreview: (delayMs?: number) => void;
  commitChange: () => void;
}

interface MaskTilePaintState {
  deviceId: string | null;
  paintMode: 'add' | 'remove' | null;
  touched: Set<number>;
}

const createMaskTilePaintState = (): MaskTilePaintState => ({
  deviceId: null,
  paintMode: null,
  touched: new Set<number>(),
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
  gridEl: HTMLElement,
  clientX: number,
  clientY: number,
): { tileIndex: number } | null => {
  const element = document.elementFromPoint(clientX, clientY);
  if (!element) {
    return null;
  }

  const hit = resolveMaskTileTarget(element);
  if (!hit || hit.grid !== gridEl) {
    return null;
  }

  return { tileIndex: hit.tileIndex };
};

export class MaskTilePaintController {
  private readonly findDeviceById: (id: string) => ChainDevice | null;

  private readonly blurActiveTextEditingElement: () => void;

  private readonly closeContextMenu: () => void;

  private readonly requestTransientPreview: (delayMs?: number) => void;

  private readonly commitChange: () => void;

  private readonly state = createMaskTilePaintState();

  private readonly pointerSession = new PointerCaptureSession<HTMLElement>({
    onChanged: () => this.commitChange(),
    afterFinish: () => {
      Object.assign(this.state, createMaskTilePaintState());
    },
  });

  public constructor(options: MaskTilePaintControllerOptions) {
    this.findDeviceById = options.findDeviceById;
    this.blurActiveTextEditingElement = options.blurActiveTextEditingElement;
    this.closeContextMenu = options.closeContextMenu;
    this.requestTransientPreview = options.requestTransientPreview;
    this.commitChange = options.commitChange;
  }

  public isActive(): boolean {
    return this.pointerSession.isActive();
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

    this.state.deviceId = hit.deviceId;
    this.state.touched = new Set<number>();
    this.state.paintMode = device.params.tiles.includes(hit.tileIndex) ? 'remove' : 'add';

    this.pointerSession.begin(hit.grid, event.pointerId);
    this.applyTileChangeWithPreview(hit.deviceId, hit.tileIndex, this.state.paintMode);

    event.preventDefault();
    return true;
  }

  public handlePointerMove(event: PointerEvent): boolean {
    const grid = this.pointerSession.target;
    if (
      !this.pointerSession.matches(event.pointerId)
      || !grid
      || !this.state.deviceId
      || !this.state.paintMode
    ) {
      return false;
    }

    const hit = resolveMaskTileFromPoint(grid, event.clientX, event.clientY);
    if (!hit || this.state.touched.has(hit.tileIndex)) {
      return true;
    }

    this.applyTileChangeWithPreview(
      this.state.deviceId,
      hit.tileIndex,
      this.state.paintMode,
    );
    return true;
  }

  public handlePointerUp(event: PointerEvent): boolean {
    return this.pointerSession.finishForPointer(event.pointerId);
  }

  public handlePointerCancel(event: PointerEvent): boolean {
    return this.pointerSession.finishForPointer(event.pointerId);
  }

  public handleWindowBlur(): void {
    if (this.isActive()) {
      this.pointerSession.finish();
    }
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

  private applyTileChangeWithPreview(
    deviceId: string,
    tileIndex: number,
    mode: 'add' | 'remove',
  ): void {
    if (!this.applyTileChange(deviceId, tileIndex, mode)) {
      return;
    }

    this.state.touched.add(tileIndex);
    this.pointerSession.markChanged();
    this.requestTransientPreview();
  }

}
