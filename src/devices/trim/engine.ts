import { applyTrimEffect } from '../../core/effects/trim';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const trimEngineHandler = {
  kind: 'trim',
  applyEffect(sceneInstances, effect) {
    return applyTrimEffect(sceneInstances, effect.params.start, effect.params.end);
  },
} satisfies EffectDeviceEngineHandler<'trim'>;
