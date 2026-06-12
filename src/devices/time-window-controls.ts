import { clamp } from '../shared/math';
import type { GeneratorDeviceNode } from '../shared/model';
import {
  createNumericParamSetter,
  readControlParam,
} from './control-helpers';
import type { RendererControlChange, RendererControlHandler } from './control-types';

const TIME_WINDOW_PARAM_KEYS = ['start', 'end'] as const;

type TimeWindowParamKey = (typeof TIME_WINDOW_PARAM_KEYS)[number];
type TimeWindowValue = {
  start: number;
  end: number;
};

const MIN_TIME_WINDOW_SPAN_FALLBACK = 0.001;

const resolveMinimumTimeWindowSpan = (
  change: RendererControlChange,
): number => {
  const step = Number(change.step);
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

const resolveTimeWindowInputValue = (
  currentWindow: TimeWindowValue,
  param: TimeWindowParamKey,
  rawValue: number,
  change: RendererControlChange,
): TimeWindowValue => {
  const minimumSpan = resolveMinimumTimeWindowSpan(change);

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
  change: RendererControlChange,
): TimeWindowParamKey | null => readControlParam(change, TIME_WINDOW_PARAM_KEYS);

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
  assign: (device, param, value, change) => {
    const nextWindow = resolveTimeWindowInputValue(
      options.readWindow(device),
      param,
      value,
      change,
    );
    options.writeWindow(device, nextWindow);
  },
});
