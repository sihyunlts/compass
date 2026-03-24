import { clamp } from '../shared/math';
import type { GeneratorDeviceNode } from '../shared/model';
import {
  createNumericParamSetter,
  readDatasetParam,
} from './control-helpers';
import type { RendererControlHandler } from './control-types';

export const TIME_WINDOW_PARAM_KEYS = ['start', 'end'] as const;

type TimeWindowParamKey = (typeof TIME_WINDOW_PARAM_KEYS)[number];
type TimeWindowValue = {
  start: number;
  end: number;
};

const MIN_TIME_WINDOW_SPAN_FALLBACK = 0.001;

const resolveMinimumTimeWindowSpan = (
  input: HTMLInputElement,
): number => {
  const step = Number(input.step);
  if (!Number.isFinite(step) || step <= 0) {
    return MIN_TIME_WINDOW_SPAN_FALLBACK;
  }

  return clamp(step, MIN_TIME_WINDOW_SPAN_FALLBACK, 1);
};

const clampTimeWindowStart = (
  value: number,
  end: number,
  minimumSpan: number,
): number => clamp(value, 0, Math.max(0, end - minimumSpan));

const clampTimeWindowEnd = (
  value: number,
  start: number,
  minimumSpan: number,
): number => clamp(value, Math.min(1, start + minimumSpan), 1);

export const resolveTimeWindowInputValue = (
  currentWindow: TimeWindowValue,
  param: TimeWindowParamKey,
  rawValue: number,
  input: HTMLInputElement,
): TimeWindowValue => {
  const minimumSpan = resolveMinimumTimeWindowSpan(input);

  if (param === 'start') {
    const fixedEnd = clamp(currentWindow.end, minimumSpan, 1);
    return {
      start: clampTimeWindowStart(rawValue, fixedEnd, minimumSpan),
      end: fixedEnd,
    };
  }

  const fixedStart = clamp(currentWindow.start, 0, 1 - minimumSpan);
  return {
    start: fixedStart,
    end: clampTimeWindowEnd(rawValue, fixedStart, minimumSpan),
  };
};

export const readTimeWindowParamKey = (
  input: HTMLInputElement,
): TimeWindowParamKey | null => readDatasetParam(input, TIME_WINDOW_PARAM_KEYS);

export const createTimeWindowParamSetter = <
  Device extends GeneratorDeviceNode,
>(
  options: {
    isKind: (device: GeneratorDeviceNode) => device is Device;
    readWindow: (device: Device) => TimeWindowValue;
    writeWindow: (device: Device, nextWindow: TimeWindowValue) => void;
  },
): RendererControlHandler => createNumericParamSetter({
  isKind: options.isKind,
  readParam: readTimeWindowParamKey,
  assign: (device, param, value, input) => {
    const nextWindow = resolveTimeWindowInputValue(
      options.readWindow(device),
      param,
      value,
      input,
    );
    options.writeWindow(device, nextWindow);
  },
});
