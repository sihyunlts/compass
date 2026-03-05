import { applyRotateEffect } from '../../core/effects/rotate';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const rotateEngineHandler = {
  kind: 'rotate',
  applyEffect(layers, effect, context) {
    return applyRotateEffect(layers, effect, context.worldBounds);
  },
} satisfies EffectDeviceEngineHandler<'rotate'>;
