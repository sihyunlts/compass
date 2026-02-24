import type { GeneratorLayer } from '../core-types';
import { applyReverseTemporalToLayer } from '../layer-utils';

export const applyReverseEffect = (
  layers: ReadonlyArray<GeneratorLayer>,
): GeneratorLayer[] => layers.map((layer) => applyReverseTemporalToLayer(layer));
