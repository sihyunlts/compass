import type { ColorDeviceConfig } from '../../devices/color/color-program';
import type {
  CompiledColorAgeKernel,
} from './types';

export const compileColorAgeKernel = (
  config: ColorDeviceConfig,
): CompiledColorAgeKernel => {
  const noteLengthRatio = config.noteLengthPercent / 100;
  const gapRatio = config.gapPercent / 100;

  return {
    noteLengthRatio,
    gapRatio,
    slots: config.velocities.map((velocity, slotIndex) => ({
      slotIndex,
      velocity,
    })),
  };
};
