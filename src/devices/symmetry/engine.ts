import { applySymmetryEffect } from '../../core/effects/symmetry';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const symmetryEngineHandler = {
  kind: 'symmetry',
  applyEffect(layers, effect, context) {
    return applySymmetryEffect(layers, effect, context.worldBounds);
  },
} satisfies EffectDeviceEngineHandler<'symmetry'>;
