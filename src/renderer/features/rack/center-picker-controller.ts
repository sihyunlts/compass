import type { GeneratorChain } from '../../../shared/model';
import { clamp } from '../../../shared/math';

const DEFAULT_PICKER_MIN = 0;
const DEFAULT_PICKER_MAX = 9;
const DEFAULT_PICKER_STEP = 0.5;

type ChainDevice = GeneratorChain['devices'][number];
type CenterPickerDevice = Extract<ChainDevice, { kind: 'waterdrop' | 'spiral' }>;

interface CenterPickerControllerOptions {
  findDeviceById: (id: string) => ChainDevice | null;
  getCardElement: (id: string) => HTMLElement | null;
  blurActiveTextEditingElement: () => void;
  closeContextMenu: () => void;
  scheduleAutoPreview: (delayMs?: number) => void;
  persistChange: () => void;
  commitReset: () => void;
}

interface CenterPickerState {
  pointerId: number | null;
  surfaceEl: HTMLElement | null;
  didChange: boolean;
}

const isCenterPickerDevice = (device: ChainDevice | null): device is CenterPickerDevice => (
  !!device && (device.kind === 'waterdrop' || device.kind === 'spiral')
);

const createCenterPickerState = (): CenterPickerState => ({
  pointerId: null,
  surfaceEl: null,
  didChange: false,
});

const resolveCenterPickerSurface = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  return target.closest<HTMLElement>('.center-picker-surface[data-action="set-center-point"]');
};

const parsePickerBound = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const resolvePickerBounds = (surface: HTMLElement): { min: number; max: number; step: number } => ({
  min: parsePickerBound(surface.dataset.min, DEFAULT_PICKER_MIN),
  max: parsePickerBound(surface.dataset.max, DEFAULT_PICKER_MAX),
  step: parsePickerBound(surface.dataset.step, DEFAULT_PICKER_STEP),
});

const snapPickerCoordinate = (value: number, min: number, max: number, step: number): number => {
  const safeStep = Number.isFinite(step) && step > 0 ? step : DEFAULT_PICKER_STEP;
  const clamped = clamp(value, min, max);
  const snapped = Math.round(clamped / safeStep) * safeStep;
  return Number(clamp(snapped, min, max).toFixed(3));
};

const updateCenterPickerSurface = (
  surface: HTMLElement,
  centerXRaw: number,
  centerYRaw: number,
): void => {
  const { min, max, step } = resolvePickerBounds(surface);
  const centerX = snapPickerCoordinate(centerXRaw, min, max, step);
  const centerY = snapPickerCoordinate(centerYRaw, min, max, step);
  const range = Math.max(max - min, 0.000001);
  const xPercent = ((centerX - min) / range) * 100;
  const yPercent = (1 - (centerY - min) / range) * 100;

  surface.style.setProperty('--picker-x', `${xPercent.toFixed(3)}%`);
  surface.style.setProperty('--picker-y', `${yPercent.toFixed(3)}%`);
};

const resolvePickerPoint = (
  surface: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } | null => {
  const rect = surface.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const { min, max, step } = resolvePickerBounds(surface);
  const ratioX = clamp((clientX - rect.left) / rect.width, 0, 1);
  const ratioY = clamp((clientY - rect.top) / rect.height, 0, 1);
  const rawX = min + ratioX * (max - min);
  const rawY = max - ratioY * (max - min);

  return {
    x: snapPickerCoordinate(rawX, min, max, step),
    y: snapPickerCoordinate(rawY, min, max, step),
  };
};

export class CenterPickerController {
  private readonly findDeviceById: (id: string) => ChainDevice | null;

  private readonly getCardElement: (id: string) => HTMLElement | null;

  private readonly blurActiveTextEditingElement: () => void;

  private readonly closeContextMenu: () => void;

  private readonly scheduleAutoPreview: (delayMs?: number) => void;

  private readonly persistChange: () => void;

  private readonly commitReset: () => void;

  private readonly state = createCenterPickerState();

  public constructor(options: CenterPickerControllerOptions) {
    this.findDeviceById = options.findDeviceById;
    this.getCardElement = options.getCardElement;
    this.blurActiveTextEditingElement = options.blurActiveTextEditingElement;
    this.closeContextMenu = options.closeContextMenu;
    this.scheduleAutoPreview = options.scheduleAutoPreview;
    this.persistChange = options.persistChange;
    this.commitReset = options.commitReset;
  }

  public isActive(): boolean {
    return this.state.pointerId !== null;
  }

  public syncSelection(deviceId: string): void {
    const device = this.findDeviceById(deviceId);
    if (!isCenterPickerDevice(device)) {
      return;
    }

    const card = this.getCardElement(deviceId);
    const surface = card?.querySelector<HTMLElement>('.center-picker-surface');
    if (surface) {
      updateCenterPickerSurface(surface, device.params.centerX, device.params.centerY);
    }
  }

  public handlePointerDown(event: PointerEvent, target: EventTarget | null): boolean {
    const surface = resolveCenterPickerSurface(target);
    if (!surface) {
      return false;
    }

    this.blurActiveTextEditingElement();
    this.closeContextMenu();
    this.state.pointerId = event.pointerId;
    this.state.surfaceEl = surface;
    this.state.didChange = false;
    surface.setPointerCapture(event.pointerId);

    if (this.applyPosition(surface, event.clientX, event.clientY)) {
      this.state.didChange = true;
      this.scheduleAutoPreview();
    }
    return true;
  }

  public handlePointerMove(event: PointerEvent): boolean {
    if (this.state.pointerId !== event.pointerId || !this.state.surfaceEl) {
      return false;
    }

    if (this.applyPosition(this.state.surfaceEl, event.clientX, event.clientY)) {
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

  public tryResetFromDoubleClick(target: EventTarget | null): boolean {
    const surface = resolveCenterPickerSurface(target);
    if (!surface) {
      return false;
    }

    this.blurActiveTextEditingElement();
    this.closeContextMenu();
    if (this.resetToMidpoint(surface)) {
      this.commitReset();
    }
    return true;
  }

  private applyPosition(
    surface: HTMLElement,
    clientX: number,
    clientY: number,
  ): boolean {
    const id = surface.dataset.id;
    if (!id) {
      return false;
    }

    const point = resolvePickerPoint(surface, clientX, clientY);
    if (!point) {
      return false;
    }

    const device = this.findDeviceById(id);
    if (!isCenterPickerDevice(device)) {
      return false;
    }

    if (
      Math.abs(device.params.centerX - point.x) < 0.0001
      && Math.abs(device.params.centerY - point.y) < 0.0001
    ) {
      return false;
    }

    device.params.centerX = point.x;
    device.params.centerY = point.y;
    updateCenterPickerSurface(surface, point.x, point.y);
    this.syncSelection(id);
    return true;
  }

  private resetToMidpoint(surface: HTMLElement): boolean {
    const id = surface.dataset.id;
    if (!id) {
      return false;
    }

    const device = this.findDeviceById(id);
    if (!isCenterPickerDevice(device)) {
      return false;
    }

    const { min, max, step } = resolvePickerBounds(surface);
    const midpointRaw = min + ((max - min) / 2);
    const midpoint = snapPickerCoordinate(midpointRaw, min, max, step);

    if (
      Math.abs(device.params.centerX - midpoint) < 0.0001
      && Math.abs(device.params.centerY - midpoint) < 0.0001
    ) {
      return false;
    }

    device.params.centerX = midpoint;
    device.params.centerY = midpoint;
    updateCenterPickerSurface(surface, midpoint, midpoint);
    this.syncSelection(id);
    return true;
  }

  private finish(shouldPersist: boolean): void {
    if (
      this.state.surfaceEl
      && this.state.pointerId !== null
      && this.state.surfaceEl.hasPointerCapture(this.state.pointerId)
    ) {
      this.state.surfaceEl.releasePointerCapture(this.state.pointerId);
    }

    if (shouldPersist && this.state.didChange) {
      this.persistChange();
    }

    this.state.pointerId = null;
    this.state.surfaceEl = null;
    this.state.didChange = false;
  }
}
