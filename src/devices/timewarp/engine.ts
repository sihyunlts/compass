import { applyTimeWarpEffect } from '../../core/effects/timewarp';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const timeWarpEngineHandler = {
  kind: 'timewarp',
  applyEffect(sceneInstances, effect, context) {
    return applyTimeWarpEffect(sceneInstances, effect.params.curve, context);
  },
} satisfies EffectDeviceEngineHandler<'timewarp'>;
