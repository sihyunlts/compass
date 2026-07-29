import { clamp } from '../shared/math';
import {
  customNumericParameter,
  defineNumericParameterRules,
  type NumericParameterRules,
} from './numeric-parameters';

interface TimeWindowParams {
  start: number;
  end: number;
}

const MIN_TIME_WINDOW_SPAN = 0.001;

const resolveMinimumSpan = (step: number | undefined): number => {
  if (!Number.isFinite(step) || (step ?? 0) <= 0) {
    return MIN_TIME_WINDOW_SPAN;
  }
  return clamp(step as number, MIN_TIME_WINDOW_SPAN, 1);
};

export const createTimeWindowNumericParameters = (
  defaults: Readonly<TimeWindowParams>,
): NumericParameterRules<TimeWindowParams> => defineNumericParameterRules<
  TimeWindowParams
>()({
  start: customNumericParameter({
    defaultValue: defaults.start,
    min: 0,
    max: 1,
    step: MIN_TIME_WINDOW_SPAN,
    modulationLabel: 'Start',
    normalize: (value, currentParams, context) => {
      const minimumSpan = resolveMinimumSpan(context.step);
      const end = typeof currentParams.end === 'number' && Number.isFinite(currentParams.end)
        ? clamp(currentParams.end, minimumSpan, 1)
        : defaults.end;
      return clamp(value, 0, Math.max(0, end - minimumSpan));
    },
  }),
  end: customNumericParameter({
    defaultValue: defaults.end,
    min: 0,
    max: 1,
    step: MIN_TIME_WINDOW_SPAN,
    modulationLabel: 'End',
    normalize: (value, currentParams, context) => {
      const minimumSpan = resolveMinimumSpan(context.step);
      const start = typeof currentParams.start === 'number' && Number.isFinite(currentParams.start)
        ? clamp(currentParams.start, 0, 1 - minimumSpan)
        : defaults.start;
      return clamp(value, Math.min(1, start + minimumSpan), 1);
    },
  }),
});
