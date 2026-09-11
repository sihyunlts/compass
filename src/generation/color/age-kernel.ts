import type { ColorDeviceConfig } from '../../devices/color/color-program';
import type { CompiledColorAgeKernel } from './types';

export const compileColorAgeKernel = (
  config: ColorDeviceConfig,
): CompiledColorAgeKernel => {
  const noteLengthRatio = config.noteLengthPercent / 100;
  const gapRatio = config.gapPercent / 100;
  const slots = config.velocities.map((velocity, slotIndex) => ({
    slotIndex,
    velocity,
    startUnit: slotIndex * (noteLengthRatio + gapRatio),
    endUnitExclusive: (slotIndex * (noteLengthRatio + gapRatio)) + noteLengthRatio,
  }));

  return {
    sequenceEndUnit: (config.velocities.length * noteLengthRatio)
      + ((config.velocities.length - 1) * gapRatio),
    slotCount: slots.length,
    coverageIntervals: gapRatio === 0
      ? [{
          startUnit: slots[0].startUnit,
          endUnitExclusive: slots[slots.length - 1].endUnitExclusive,
          slots,
        }]
      : slots.map((slot) => ({
          startUnit: slot.startUnit,
          endUnitExclusive: slot.endUnitExclusive,
          slots: [slot],
        })),
  };
};
