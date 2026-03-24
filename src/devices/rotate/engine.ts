import { applyRotateEffect } from '../../core/effects/rotate';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const rotateEngineHandler = {
  kind: 'rotate',
  applyEffect(sceneInstances, effect, context) {
    return applyRotateEffect(sceneInstances, effect, context.worldBounds);
  },
} satisfies EffectDeviceEngineHandler<'rotate'>;
