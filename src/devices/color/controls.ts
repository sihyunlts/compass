import {
  createMergeKeyResolver,
  parseFiniteNumber,
  requireButton,
  requireInput,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';

const DEFAULT_COLOR_SLOT_VELOCITY = 3;
const MIN_COLOR_SLOT_COUNT = 1;

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
        (control) => resolveColorSlotIndex(control.dataset.slotIndex)?.toString() ?? null,
      ),
    },
    'set-color-note-length-percent': {
      resolveMergeKey: createMergeKeyResolver('set-color-note-length-percent'),
      resolveDefaultValue: (defaultDevice) =>
        defaultDevice.kind === 'color'
          ? defaultDevice.params.noteLengthPercent
          : null,
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
    'set-color-slot': (device, target) => {
      if (device.kind !== 'color') {
        return false;
      }

      const button = requireButton(target);
      if (!button || button.disabled) {
        return false;
      }

      const slotIndex = resolveColorSlotIndex(button.dataset.slotIndex);
      const paletteIndex = resolveColorSlotIndex(button.dataset.paletteIndex);
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
    'set-color-note-length-percent': (device, target) => {
      if (device.kind !== 'color') {
        return false;
      }

      const input = requireInput(target);
      if (!input) {
        return false;
      }

      const value = parseFiniteNumber(input.value);
      if (value === null) {
        return false;
      }

      device.params.noteLengthPercent = Math.min(400, Math.max(1, value));
      return true;
    },
    'set-color-slot-count': (device, target) => {
      if (device.kind !== 'color') {
        return false;
      }

      const input = requireInput(target);
      if (!input) {
        return false;
      }

      const value = parseFiniteNumber(input.value);
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
