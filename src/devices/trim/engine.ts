import { applyTrimEffect } from '../../core/effects/trim';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const trimEngineHandler = {
  kind: 'trim',
  applyEffect(sceneInstances, effect, context) {
    return applyTrimEffect(sceneInstances, effect.params.start, effect.params.end, context);
  },
} satisfies EffectDeviceEngineHandler<'trim'>;
