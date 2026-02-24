import type { GeneratorChain } from '../../../shared/types';
import { clamp } from '../../../shared/math';

const DEFAULT_PICKER_MIN = 0;
const DEFAULT_PICKER_MAX = 9;
const DEFAULT_PICKER_STEP = 0.5;

type ChainDevice = GeneratorChain['devices'][number];
type CenterPickerDevice = Extract<ChainDevice, { kind: 'waterdrop' | 'spiral' }>;

interface CenterPickerSessionState {
  pointerId: number | null;
  surfaceEl: HTMLElement | null;
  didChange: boolean;
}

interface CenterPickerDeps {
  findDeviceById: (id: string) => ChainDevice | null;
  getCardElement: (id: string) => HTMLElement | null;
}

const isCenterPickerDevice = (device: ChainDevice | null): device is CenterPickerDevice => (
  !!device && (device.kind === 'waterdrop' || device.kind === 'spiral')
);

/** Creates an idle center-picker session with no captured pointer. */
export const createCenterPickerSessionState = (): CenterPickerSessionState => ({
  pointerId: null,
  surfaceEl: null,
  didChange: false,
});

/** Returns true when a center-picker pointer is currently captured. */
export const isCenterPickerActive = (state: CenterPickerSessionState): boolean =>
  state.pointerId !== null;

/** Returns true when the pointer ID matches the active center-picker session. */
export const isCenterPickerPointer = (
  state: CenterPickerSessionState,
  pointerId: number,
): boolean => state.pointerId === pointerId;

/** Resolves the nearest center-picker surface for set-center-point interactions. */
export const resolveCenterPickerSurface = (target: EventTarget | null): HTMLElement | null => {
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

  surface.dataset.centerX = centerX.toFixed(1);
  surface.dataset.centerY = centerY.toFixed(1);
  surface.style.setProperty('--picker-x', `${xPercent.toFixed(3)}%`);
  surface.style.setProperty('--picker-y', `${yPercent.toFixed(3)}%`);

  const readout = surface
    .closest('.center-picker')
    ?.querySelector<HTMLElement>('.center-picker-readout');
  if (readout) {
    readout.textContent = `X ${centerX.toFixed(1)} | Y ${centerY.toFixed(1)}`;
  }
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

/** Syncs picker marker UI and readout from the current device center parameters. */
export const syncCenterPickerSelection = (
  deviceId: string,
  deps: CenterPickerDeps,
): void => {
  const device = deps.findDeviceById(deviceId);
  if (!isCenterPickerDevice(device)) {
    return;
  }

  const card = deps.getCardElement(deviceId);
  if (!card) {
    return;
  }

  const surface = card.querySelector<HTMLElement>('.center-picker-surface');
  if (surface) {
    updateCenterPickerSurface(surface, device.params.centerX, device.params.centerY);
  }
};

/** Snaps pointer coordinates to picker bounds and applies changed device center values. */
export const applyCenterPickerPosition = (
  surface: HTMLElement,
  clientX: number,
  clientY: number,
  deps: CenterPickerDeps,
): boolean => {
  const id = surface.dataset.id;
  if (!id) {
    return false;
  }

  const point = resolvePickerPoint(surface, clientX, clientY);
  if (!point) {
    return false;
  }

  const device = deps.findDeviceById(id);
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
  syncCenterPickerSelection(id, deps);
  return true;
};

/** Captures the pointer for center picking and resets session dirty state. */
export const startCenterPickerSession = (
  state: CenterPickerSessionState,
  pointerId: number,
  surface: HTMLElement,
): void => {
  state.pointerId = pointerId;
  state.surfaceEl = surface;
  state.didChange = false;
  surface.setPointerCapture(pointerId);
};

/** Applies pointer moves only when they belong to the active center-picker session. */
export const applyCenterPickerPointerMove = (
  state: CenterPickerSessionState,
  pointerId: number,
  clientX: number,
  clientY: number,
  deps: CenterPickerDeps,
): boolean => {
  if (state.pointerId !== pointerId || !state.surfaceEl) {
    return false;
  }

  return applyCenterPickerPosition(state.surfaceEl, clientX, clientY, deps);
};

/** Releases center-picker capture state and persists once when the session changed. */
export const clearCenterPickerPointerState = (
  state: CenterPickerSessionState,
  persist: boolean,
  onPersist: () => void,
): void => {
  if (
    state.surfaceEl
    && state.pointerId !== null
    && state.surfaceEl.hasPointerCapture(state.pointerId)
  ) {
    state.surfaceEl.releasePointerCapture(state.pointerId);
  }

  if (persist && state.didChange) {
    onPersist();
  }

  state.pointerId = null;
  state.surfaceEl = null;
  state.didChange = false;
};
