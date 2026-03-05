import type { Bounds, GeneratorLayer, Polyline } from '../core/core-types';
import type { GeneratorDeviceNode, GeneratorNode } from '../shared/types';
import { maskEngineHandler } from './mask/engine';
import { mirrorEngineHandler } from './mirror/engine';
import { reverseEngineHandler } from './reverse/engine';
import { rotateEngineHandler } from './rotate/engine';
import { scannerEngineHandler } from './scanner/engine';
import { spiralEngineHandler } from './spiral/engine';
import { symmetryEngineHandler } from './symmetry/engine';
import type {
  EffectApplicationContext,
  EffectDeviceEngineHandler,
  GeneratorDeviceEngineHandler,
  GeneratorDeviceKind,
  MutedSourceDescriptor,
  PipelineEffectKind,
  PipelineEffectNode,
} from './engine-types';
import { waterdropEngineHandler } from './waterdrop/engine';

const generatorDeviceEngineHandlers = {
  waterdrop: waterdropEngineHandler,
  scanner: scannerEngineHandler,
  spiral: spiralEngineHandler,
} as const satisfies Record<GeneratorDeviceKind, GeneratorDeviceEngineHandler>;

const pipelineEffectEngineHandlers = {
  mirror: mirrorEngineHandler,
  mask: maskEngineHandler,
  symmetry: symmetryEngineHandler,
  rotate: rotateEngineHandler,
  reverse: reverseEngineHandler,
} as const satisfies Record<PipelineEffectKind, EffectDeviceEngineHandler>;

const GENERATOR_KIND_SET = new Set<GeneratorDeviceKind>(
  Object.keys(generatorDeviceEngineHandlers) as GeneratorDeviceKind[],
);
const PIPELINE_EFFECT_KIND_SET = new Set<PipelineEffectKind>(
  Object.keys(pipelineEffectEngineHandlers) as PipelineEffectKind[],
);

export type {
  EffectApplicationContext,
  GeneratorDeviceEngineHandler,
  GeneratorDeviceKind,
  MutedSourceDescriptor,
  PipelineEffectKind,
  PipelineEffectNode,
} from './engine-types';

export const isGeneratorEngineKind = (
  kind: GeneratorDeviceNode['kind'],
): kind is GeneratorDeviceKind => GENERATOR_KIND_SET.has(kind as GeneratorDeviceKind);

export const isGeneratorEngineNode = (
  device: GeneratorDeviceNode,
): device is GeneratorNode => isGeneratorEngineKind(device.kind);

export const isPipelineEffectKind = (
  kind: GeneratorDeviceNode['kind'],
): kind is PipelineEffectKind => PIPELINE_EFFECT_KIND_SET.has(kind as PipelineEffectKind);

export const isPipelineEffectNode = (
  device: GeneratorDeviceNode,
): device is PipelineEffectNode => isPipelineEffectKind(device.kind);

const getGeneratorEngineHandler = <K extends GeneratorDeviceKind>(
  kind: K,
): GeneratorDeviceEngineHandler<K> =>
  generatorDeviceEngineHandlers[kind] as GeneratorDeviceEngineHandler<K>;

const getPipelineEffectEngineHandler = <K extends PipelineEffectKind>(
  kind: K,
): EffectDeviceEngineHandler<K> =>
  pipelineEffectEngineHandlers[kind] as EffectDeviceEngineHandler<K>;

export const createGeneratorLayer = (
  device: GeneratorNode,
  worldBounds: Bounds,
): GeneratorLayer | null =>
  getGeneratorEngineHandler(device.kind).createLayer(device, worldBounds);

export const buildGeneratorPolyline = (
  layer: GeneratorLayer,
  t01: number,
  step: number,
): Polyline | null =>
  getGeneratorEngineHandler(layer.kind).buildPolyline(layer, t01, step);

export const applyPipelineEffect = (
  layers: ReadonlyArray<GeneratorLayer>,
  effect: PipelineEffectNode,
  context: EffectApplicationContext,
): GeneratorLayer[] =>
  getPipelineEffectEngineHandler(effect.kind).applyEffect(layers, effect, context);

export const doesDeviceToggleTimelineParity = (
  device: GeneratorDeviceNode,
): boolean => (
  isPipelineEffectNode(device)
  && getPipelineEffectEngineHandler(device.kind).togglesTimelineParity === true
);

export const resolveEffectMutedSource = (
  device: GeneratorDeviceNode,
): MutedSourceDescriptor | null => {
  if (!isPipelineEffectNode(device)) {
    return null;
  }

  return getPipelineEffectEngineHandler(device.kind).resolveMutedSource?.(device) ?? null;
};
