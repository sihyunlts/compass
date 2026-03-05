import { applyReverseEffect } from '../../core/effects/reverse';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const reverseEngineHandler = {
  kind: 'reverse',
  togglesTimelineParity: true,
  applyEffect(layers) {
    return applyReverseEffect(layers);
  },
} satisfies EffectDeviceEngineHandler<'reverse'>;
