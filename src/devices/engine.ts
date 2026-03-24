import type { Bounds, Polyline, SceneInstance, SceneInstanceOfKind } from '../core/core-types';
import type { GeneratorDeviceNode, GeneratorNode } from '../shared/model';
import { maskEngineHandler } from './mask/engine';
import { mirrorEngineHandler } from './mirror/engine';
import { reverseEngineHandler } from './reverse/engine';
import { rotateEngineHandler } from './rotate/engine';
import { scannerEngineHandler } from './scanner/engine';
import { spiralEngineHandler } from './spiral/engine';
import { symmetryEngineHandler } from './symmetry/engine';
import { pathEngineHandler } from './path/engine';
import { translateEngineHandler } from './translate/engine';
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
  path: pathEngineHandler,
} as const satisfies Record<GeneratorDeviceKind, GeneratorDeviceEngineHandler>;

const pipelineEffectEngineHandlers = {
  mirror: mirrorEngineHandler,
  mask: maskEngineHandler,
  symmetry: symmetryEngineHandler,
  rotate: rotateEngineHandler,
  translate: translateEngineHandler,
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
  if (device.kind === 'spiral') {
    return spiralEngineHandler.createSceneInstance(device, worldBounds);
  }
  return pathEngineHandler.createSceneInstance(device, worldBounds);
};

export const buildGeneratorPolyline = (
  sceneInstance: SceneInstance,
  t01: number,
  step: number,
): Polyline | null => {
  if (sceneInstance.primitive.kind === 'waterdrop') {
    return waterdropEngineHandler.buildPolyline(sceneInstance as SceneInstanceOfKind<'waterdrop'>, t01, step);
  }
  if (sceneInstance.primitive.kind === 'scanner') {
    return scannerEngineHandler.buildPolyline(sceneInstance as SceneInstanceOfKind<'scanner'>, t01, step);
  }
  if (sceneInstance.primitive.kind === 'spiral') {
    return spiralEngineHandler.buildPolyline(sceneInstance as SceneInstanceOfKind<'spiral'>, t01, step);
  }
  return pathEngineHandler.buildPolyline(sceneInstance as SceneInstanceOfKind<'path'>);
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
