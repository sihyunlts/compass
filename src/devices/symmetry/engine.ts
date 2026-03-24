import { applySymmetryEffect } from '../../core/effects/symmetry';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const symmetryEngineHandler = {
  kind: 'symmetry',
  applyEffect(sceneInstances, effect, context) {
    return applySymmetryEffect(sceneInstances, effect, context.worldBounds);
  },
} satisfies EffectDeviceEngineHandler<'symmetry'>;
