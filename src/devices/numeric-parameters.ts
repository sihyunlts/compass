import { clamp } from '../shared/math';
import type { MessageKey } from '../shared/i18n';

interface NumericParameterInput {
  min?: number;
  max?: number;
  step: number;
  dragPixelsPerStep?: number;
  dragMode?: 'circular';
}

export const DISCRETE_DRAG_PIXELS_PER_STEP = 8;

export type NumericParameterUnit = '°' | '%' | '×';

interface NumericParameterDisplay {
  unit?: NumericParameterUnit;
  format?: 'rotation';
}

export const formatNumericParameterValue = (
  valueText: string,
  unit: NumericParameterUnit | undefined,
): string => {
  return unit ? `${valueText}${unit}` : valueText;
};

const formatRotationValue = (value: number, valueText: string): string => {
  const displayedValue = parseFiniteNumericParameterValue(valueText) ?? value;
  const magnitude = Math.abs(displayedValue);
  const fullRotations = Math.floor(magnitude / 360);
  const directionDegrees = magnitude - fullRotations * 360;
  const decimalMatch = valueText.match(/\.(\d+)/);
  const directionText = decimalMatch
    ? directionDegrees.toFixed(decimalMatch[1].length)
    : String(directionDegrees);
  const sign = displayedValue < 0 ? '−' : '';

  return fullRotations > 0
    ? `${sign}${fullRotations}× ${directionText}°`
    : `${sign}${directionText}°`;
};

export const formatNumericParameterDisplayValue = (
  rule: NumericParameterRule,
  value: number,
  valueText = String(value),
): string => (
  rule.display.format === 'rotation'
    ? formatRotationValue(value, valueText)
    : formatNumericParameterValue(valueText, rule.display.unit)
);

export interface ModulationParameterDefinition {
  key: string;
  messageKey: MessageKey;
  unit?: NumericParameterUnit;
}

interface NumericParameterWriteContext {
  step?: number;
}

type NumericParameterRecord = Record<string, unknown>;

export interface NumericParameterRule {
  defaultValue: number;
  input: Readonly<NumericParameterInput>;
  display: Readonly<NumericParameterDisplay>;
  modulationMessageKey?: MessageKey;
  normalize: (
    value: number,
    currentParams: Readonly<NumericParameterRecord>,
    context: NumericParameterWriteContext,
  ) => number | null;
}

type NumericParameterKey<Params> = {
  [Key in keyof Params]-?: Params[Key] extends number ? Key : never;
}[keyof Params] & string;

export type NumericParameterRules<Params extends object> = Partial<
  Record<NumericParameterKey<Params>, NumericParameterRule>
>;

export const defineNumericParameterRules = <Params extends object>() =>
  <Rules extends NumericParameterRules<Params>>(rules: Rules): Rules => rules;

interface NumericParameterOptions {
  defaultValue: number;
  step: number;
  min?: number;
  max?: number;
  dragPixelsPerStep?: number;
  dragMode?: 'circular';
  display?: NumericParameterDisplay;
  modulationMessageKey?: MessageKey;
}

interface BoundedNumericParameterOptions extends NumericParameterOptions {
  min: number;
  max: number;
}

interface CyclicNumericParameterOptions extends NumericParameterOptions {
  min: number;
  period: number;
}

interface CustomNumericParameterOptions extends NumericParameterOptions {
  normalize: NumericParameterRule['normalize'];
}

const validateNumericParameterOptions = (
  options: NumericParameterOptions,
): void => {
  if (!Number.isFinite(options.defaultValue)) {
    throw new Error('Numeric parameter default value must be finite.');
  }
  if (!Number.isFinite(options.step) || options.step <= 0) {
    throw new Error('Numeric parameter input step must be positive.');
  }
  if (options.min !== undefined && !Number.isFinite(options.min)) {
    throw new Error('Numeric parameter input minimum must be finite.');
  }
  if (options.max !== undefined && !Number.isFinite(options.max)) {
    throw new Error('Numeric parameter input maximum must be finite.');
  }
  if (
    options.dragPixelsPerStep !== undefined
    && (!Number.isFinite(options.dragPixelsPerStep) || options.dragPixelsPerStep <= 0)
  ) {
    throw new Error('Numeric parameter drag pixels per step must be positive.');
  }
  if (
    options.min !== undefined
    && options.max !== undefined
    && options.min > options.max
  ) {
    throw new Error('Numeric parameter input minimum cannot exceed its maximum.');
  }
};

const createNumericParameterRule = (
  options: NumericParameterOptions,
  normalize: NumericParameterRule['normalize'],
): NumericParameterRule => {
  validateNumericParameterOptions(options);
  return Object.freeze({
    defaultValue: options.defaultValue,
    input: Object.freeze({
      min: options.min,
      max: options.max,
      step: options.step,
      dragPixelsPerStep: options.dragPixelsPerStep,
      dragMode: options.dragMode,
    }),
    display: Object.freeze({
      unit: options.display?.unit,
      format: options.display?.format,
    }),
    modulationMessageKey: options.modulationMessageKey,
    normalize,
  });
};

export const finiteNumericParameter = (
  options: NumericParameterOptions,
): NumericParameterRule => createNumericParameterRule(
  options,
  (value) => value,
);

export const boundedNumericParameter = (
  options: BoundedNumericParameterOptions,
): NumericParameterRule => createNumericParameterRule(
  options,
  (value) => clamp(value, options.min, options.max),
);

export const boundedIntegerParameter = (
  options: BoundedNumericParameterOptions,
): NumericParameterRule => createNumericParameterRule(
  options,
  (value) => clamp(Math.trunc(value), options.min, options.max),
);

export const positiveNumericParameter = (
  options: NumericParameterOptions,
): NumericParameterRule => createNumericParameterRule(
  options,
  (value) => (value > 0 ? value : null),
);

export const cyclicNumericParameter = (
  options: CyclicNumericParameterOptions,
): NumericParameterRule => {
  if (!Number.isFinite(options.period) || options.period <= 0) {
    throw new Error('Cyclic numeric parameter period must be positive.');
  }

  return createNumericParameterRule(
    {
      ...options,
      max: options.min + options.period,
      dragMode: 'circular',
    },
    (value) => {
      let wrapped = (value - options.min) % options.period;
      if (wrapped < 0) {
        wrapped += options.period;
      }
      return Number((options.min + wrapped).toFixed(12));
    },
  );
};

export const customNumericParameter = (
  options: CustomNumericParameterOptions,
): NumericParameterRule => createNumericParameterRule(options, options.normalize);

export const parseFiniteNumericParameterValue = (
  value: unknown,
): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const readNumericParameterKey = <Params extends object>(
  paramKey: string | undefined,
  rules: NumericParameterRules<Params>,
): NumericParameterKey<Params> | null => {
  if (!paramKey || !Object.prototype.hasOwnProperty.call(rules, paramKey)) {
    return null;
  }
  return paramKey as NumericParameterKey<Params>;
};

export const normalizeNumericParameterValue = (
  rule: NumericParameterRule,
  rawValue: unknown,
  currentParams: Readonly<NumericParameterRecord>,
  context: NumericParameterWriteContext = {},
): number | null => {
  const value = parseFiniteNumericParameterValue(rawValue);
  return value === null ? null : rule.normalize(value, currentParams, context);
};

export const writeNumericParameterValue = <Params extends object>(
  params: Params,
  rules: NumericParameterRules<Params>,
  paramKey: string,
  rawValue: unknown,
  context: NumericParameterWriteContext = {},
): number | null => {
  const key = readNumericParameterKey(paramKey, rules);
  if (!key) {
    return null;
  }

  const rule = rules[key];
  if (!rule) {
    return null;
  }

  const paramsRecord = params as NumericParameterRecord;
  const normalized = normalizeNumericParameterValue(
    rule,
    rawValue,
    paramsRecord,
    context,
  );
  if (normalized === null) {
    return null;
  }

  paramsRecord[key] = normalized;
  return normalized;
};

export const readNumericParameterValue = <Params extends object>(
  params: Params,
  rules: NumericParameterRules<Params>,
  paramKey: string,
): number | null => {
  const key = readNumericParameterKey(paramKey, rules);
  if (!key) {
    return null;
  }

  const value = (params as NumericParameterRecord)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

export const hydrateImportedNumericParameters = <Params extends object>(
  params: Params,
  source: Readonly<Record<string, unknown>>,
  rules: NumericParameterRules<Params>,
): void => {
  for (const key of Object.keys(rules)) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) {
      continue;
    }
    writeNumericParameterValue(params, rules, key, source[key]);
  }
};
