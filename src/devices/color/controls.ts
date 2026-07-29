import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  parseFiniteControlNumber,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { COLOR_NUMERIC_PARAMETERS, DEFAULT_COLOR_PARAMS } from './schema';

const DEFAULT_COLOR_SLOT_VELOCITY = DEFAULT_COLOR_PARAMS.velocities[0];
const MIN_COLOR_SLOT_COUNT = 1;

const isColorDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'color' }> =>
  device.kind === 'color';

const resolveColorSlotIndex = (raw: string | undefined): number | null => {
  const value = raw?.trim();
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
};

export const colorDeviceControls = {
  descriptors: {
    'set-color-slot': {
      resolveMergeKey: createMergeKeyResolver(
        'set-color-slot',
        (change) => change.paramKey ?? null,
      ),
    },
    'set-color-note-length-percent': {
      resolveMergeKey: createMergeKeyResolver('set-color-note-length-percent'),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        COLOR_NUMERIC_PARAMETERS,
        () => 'noteLengthPercent',
      ),
    },
    'set-color-gap-percent': {
      resolveMergeKey: createMergeKeyResolver('set-color-gap-percent'),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        COLOR_NUMERIC_PARAMETERS,
        () => 'gapPercent',
      ),
    },
    'set-color-slot-count': {
      resolveMergeKey: createMergeKeyResolver('set-color-slot-count'),
      resolveDefaultValue: (defaultDevice) =>
        defaultDevice.kind === 'color'
          ? defaultDevice.params.velocities.length
          : null,
    },
  },
  createHandlers: () => ({
    'set-color-slot': (device, change) => {
      if (device.kind !== 'color') {
        return false;
      }

      const slotIndex = resolveColorSlotIndex(change.paramKey);
      const paletteIndex = resolveColorSlotIndex(String(change.value));
      if (slotIndex === null || paletteIndex === null) {
        return false;
      }
      if (slotIndex >= device.params.velocities.length || paletteIndex > 127) {
        return false;
      }
      if (device.params.velocities[slotIndex] === paletteIndex) {
        return false;
      }

      device.params.velocities[slotIndex] = paletteIndex;
      return true;
    },
    'set-color-note-length-percent': createNumericParameterSetter({
      isKind: isColorDevice,
      rules: COLOR_NUMERIC_PARAMETERS,
      readParam: () => 'noteLengthPercent',
    }),
    'set-color-gap-percent': createNumericParameterSetter({
      isKind: isColorDevice,
      rules: COLOR_NUMERIC_PARAMETERS,
      readParam: () => 'gapPercent',
    }),
    'set-color-slot-count': (device, change) => {
      if (device.kind !== 'color') {
        return false;
      }

      const value = parseFiniteControlNumber(change.value);
      if (value === null) {
        return false;
      }

      const nextCount = Math.max(MIN_COLOR_SLOT_COUNT, Math.round(value));
      const currentCount = device.params.velocities.length;
      if (nextCount === currentCount) {
        return false;
      }

      if (nextCount < currentCount) {
        device.params.velocities.length = nextCount;
        return true;
      }

      while (device.params.velocities.length < nextCount) {
        device.params.velocities.push(DEFAULT_COLOR_SLOT_VELOCITY);
      }
      return true;
    },
  }),
} satisfies RendererKindControlDefinition;
