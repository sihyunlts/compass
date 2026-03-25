import { applyTimeWarpEffect } from '../../core/effects/timewarp';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const timeWarpEngineHandler = {
  kind: 'timewarp',
  applyEffect(sceneInstances, effect) {
    return applyTimeWarpEffect(sceneInstances, effect.params.curve);
  },
} satisfies EffectDeviceEngineHandler<'timewarp'>;
