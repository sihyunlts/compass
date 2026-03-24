import { applyStretchEffect } from '../../core/effects/stretch';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const stretchEngineHandler = {
  kind: 'stretch',
  applyEffect(sceneInstances, effect) {
    return applyStretchEffect(sceneInstances, effect.params.start, effect.params.end);
  },
} satisfies EffectDeviceEngineHandler<'stretch'>;
