import type { Bounds, Polyline, SceneInstance } from '../core/core-types';
import type { GeneratorDeviceNode, GeneratorNode } from '../shared/model';
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

const isGeneratorEngineKind = (
  kind: GeneratorDeviceNode['kind'],
): kind is GeneratorDeviceKind => GENERATOR_KIND_SET.has(kind as GeneratorDeviceKind);

export const isGeneratorEngineNode = (
  device: GeneratorDeviceNode,
): device is GeneratorNode => isGeneratorEngineKind(device.kind);

const isPipelineEffectKind = (
  kind: GeneratorDeviceNode['kind'],
): kind is PipelineEffectKind => PIPELINE_EFFECT_KIND_SET.has(kind as PipelineEffectKind);

export const isPipelineEffectNode = (
  device: GeneratorDeviceNode,
): device is PipelineEffectNode => isPipelineEffectKind(device.kind);

const getPipelineEffectEngineHandler = <K extends PipelineEffectKind>(
  kind: K,
): EffectDeviceEngineHandler<K> =>
  pipelineEffectEngineHandlers[kind] as EffectDeviceEngineHandler<K>;

export const createSceneInstanceFromGenerator = (
  device: GeneratorNode,
  worldBounds: Bounds,
): SceneInstance | null => {
  if (device.kind === 'waterdrop') {
    return waterdropEngineHandler.createSceneInstance(device, worldBounds);
  }
  if (device.kind === 'scanner') {
    return scannerEngineHandler.createSceneInstance(device, worldBounds);
  }
  return spiralEngineHandler.createSceneInstance(device, worldBounds);
};

export const buildGeneratorPolyline = (
  sceneInstance: SceneInstance,
  t01: number,
  step: number,
): Polyline | null => {
  if (sceneInstance.primitive.kind === 'waterdrop') {
    return waterdropEngineHandler.buildPolyline(sceneInstance, t01, step);
  }
  if (sceneInstance.primitive.kind === 'scanner') {
    return scannerEngineHandler.buildPolyline(sceneInstance, t01, step);
  }
  return spiralEngineHandler.buildPolyline(sceneInstance, t01, step);
};

export const applyPipelineEffect = (
  sceneInstances: ReadonlyArray<SceneInstance>,
  effect: PipelineEffectNode,
  context: EffectApplicationContext,
): SceneInstance[] =>
  getPipelineEffectEngineHandler(effect.kind).applyEffect(sceneInstances, effect, context);

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
