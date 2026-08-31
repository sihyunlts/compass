import { writeNumericDeviceParam } from '../../../devices/modulation';
import type { GeneratorChain } from '../../../shared/model';
import { clamp } from '../../../shared/math';
import { PointerCaptureSession } from './pointer-capture-session';

const DEFAULT_PICKER_MIN = 0;
const DEFAULT_PICKER_MAX = 9;
const DEFAULT_PICKER_STEP = 0.5;

type ChainDevice = GeneratorChain['devices'][number];
type CenterPointDevice = Extract<ChainDevice, {
  params: {
    centerX: number;
    centerY: number;
  };
}>;

interface CenterPickerControllerOptions {
  findDeviceById: (id: string) => ChainDevice | null;
  getCardElement: (id: string) => HTMLElement | null;
  blurActiveTextEditingElement: () => void;
  closeContextMenu: () => void;
  requestTransientPreview: (delayMs?: number) => void;
  persistChange: () => void;
  commitReset: () => void;
}

const isCenterPointDevice = (device: ChainDevice | null): device is CenterPointDevice => (
  !!device
  && 'params' in device
  && typeof device.params === 'object'
  && device.params !== null
  && 'centerX' in device.params
  && 'centerY' in device.params
);

const resolveCenterPickerSurface = (target: EventTarget | null): HTMLElement | null => {
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  return target.closest<HTMLElement>('.center-picker-surface[data-center-picker-surface="true"]');
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
  const snapped = Math.round((clamped - min) / safeStep) * safeStep + min;
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

  private readonly requestTransientPreview: (delayMs?: number) => void;

  private readonly persistChange: () => void;

  private readonly commitReset: () => void;

  private readonly pointerSession = new PointerCaptureSession<HTMLElement>({
    onChanged: () => this.persistChange(),
    beforeRelease: (surface) => {
      delete surface.dataset.centerPickerInteraction;
    },
  });

  public constructor(options: CenterPickerControllerOptions) {
    this.findDeviceById = options.findDeviceById;
    this.getCardElement = options.getCardElement;
    this.blurActiveTextEditingElement = options.blurActiveTextEditingElement;
    this.closeContextMenu = options.closeContextMenu;
    this.requestTransientPreview = options.requestTransientPreview;
    this.persistChange = options.persistChange;
    this.commitReset = options.commitReset;
  }

  public isActive(): boolean {
    return this.pointerSession.isActive();
  }

  public syncSelection(deviceId: string): void {
    const device = this.resolveCenterPointDevice(deviceId);
    if (!device) {
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
    surface.dataset.centerPickerInteraction = 'active';
    this.pointerSession.begin(surface, event.pointerId);

    this.applyPositionWithPreview(surface, event.clientX, event.clientY);
    return true;
  }

  public handlePointerMove(event: PointerEvent): boolean {
    const surface = this.pointerSession.target;
    if (!this.pointerSession.matches(event.pointerId) || !surface) {
      return false;
    }

    this.applyPositionWithPreview(surface, event.clientX, event.clientY);
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
    const id = surface.dataset.deviceId;
    if (!id) {
      return false;
    }

    const point = resolvePickerPoint(surface, clientX, clientY);
    if (!point) {
      return false;
    }

    const device = this.resolveCenterPointDevice(id);
    if (!device) {
      return false;
    }

    if (
      Math.abs(device.params.centerX - point.x) < 0.0001
      && Math.abs(device.params.centerY - point.y) < 0.0001
    ) {
      return false;
    }

    const { step } = resolvePickerBounds(surface);
    const centerX = writeNumericDeviceParam(device, 'centerX', point.x, step);
    const centerY = writeNumericDeviceParam(device, 'centerY', point.y, step);
    if (centerX === null || centerY === null) {
      return false;
    }

    updateCenterPickerSurface(surface, centerX, centerY);
    this.syncSelection(id);
    return true;
  }

  private applyPositionWithPreview(
    surface: HTMLElement,
    clientX: number,
    clientY: number,
  ): void {
    if (!this.applyPosition(surface, clientX, clientY)) {
      return;
    }

    this.pointerSession.markChanged();
    this.requestTransientPreview();
  }

  private resetToMidpoint(surface: HTMLElement): boolean {
    const id = surface.dataset.deviceId;
    if (!id) {
      return false;
    }

    const device = this.resolveCenterPointDevice(id);
    if (!device) {
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

    const centerX = writeNumericDeviceParam(device, 'centerX', midpoint, step);
    const centerY = writeNumericDeviceParam(device, 'centerY', midpoint, step);
    if (centerX === null || centerY === null) {
      return false;
    }

    updateCenterPickerSurface(surface, centerX, centerY);
    this.syncSelection(id);
    return true;
  }

  private resolveCenterPointDevice(deviceId: string): CenterPointDevice | null {
    const device = this.findDeviceById(deviceId);
    return isCenterPointDevice(device) ? device : null;
  }

}
