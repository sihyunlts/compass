import type { ColorDeviceConfig } from '../../devices/color/color-program';
import type {
  CompiledColorAgeKernel,
} from './types';

export const compileColorAgeKernel = (
  config: ColorDeviceConfig,
): CompiledColorAgeKernel | null => {
  if (config.velocities.length === 0) {
    return null;
  }

  const noteLengthRatio = config.noteLengthPercent / 100;
  const gapRatio = Math.max(config.gapPercent / 100, 0);
  if (!Number.isFinite(noteLengthRatio) || noteLengthRatio <= 0 || !Number.isFinite(gapRatio)) {
    return null;
  }

  return {
    noteLengthRatio,
    gapRatio,
    slots: config.velocities.map((velocity, slotIndex) => ({
      slotIndex,
      velocity,
    })),
  };
};
