import { applyReverseEffect } from '../../core/effects/reverse';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const reverseEngineHandler = {
  kind: 'reverse',
  togglesTimelineParity: true,
  applyEffect(sceneInstances) {
    return applyReverseEffect(sceneInstances);
  },
} satisfies EffectDeviceEngineHandler<'reverse'>;
