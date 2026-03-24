import { applyMaskEffect } from '../../core/effects/mask';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { EffectDeviceEngineHandler } from '../engine-types';

export const maskEngineHandler = {
  kind: 'mask',
  applyEffect(sceneInstances, effect, context) {
    return applyMaskEffect(sceneInstances, effect, context.tilesOverride);
  },
  resolveMutedSource(effect) {
    if (effect.params.sourceVisibility === 'show') {
      return null;
    }

    const sourceKind = effect.params.sourceKind;
    if (sourceKind !== 'group' && sourceKind !== 'generator') {
      return null;
    }

    const sourceId = normalizeOptionalId(effect.params.sourceId);
    return sourceId ? { kind: sourceKind, sourceId } : null;
  },
} satisfies EffectDeviceEngineHandler<'mask'>;
