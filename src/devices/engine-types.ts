import type { Bounds, Polyline, SceneInstance, SceneInstanceOfKind } from '../core/core-types';
import type { GeneratorEffectNode, GeneratorNode } from '../shared/model';

export type GeneratorDeviceKind = GeneratorNode['kind'];
export type PipelineEffectNode = Exclude<GeneratorEffectNode, { kind: 'color' }>;
export type PipelineEffectKind = PipelineEffectNode['kind'];

export interface GeneratorDeviceEngineHandler<
  K extends GeneratorDeviceKind = GeneratorDeviceKind,
> {
  kind: K;
  createSceneInstance: (
    device: Extract<GeneratorNode, { kind: K }>,
    worldBounds: Bounds,
  ) => SceneInstance | null;
  buildPolyline: (
    sceneInstance: SceneInstanceOfKind<K>,
    t01: number,
    step: number,
  ) => Polyline | null;
}

export interface MutedSourceDescriptor {
  kind: 'group' | 'generator';
  sourceId: string;
}

export interface EffectApplicationContext {
  worldBounds: Bounds;
  tilesOverride?: Iterable<number> | null;
}

export interface EffectDeviceEngineHandler<
  K extends PipelineEffectKind = PipelineEffectKind,
> {
  kind: K;
  applyEffect: (
    sceneInstances: ReadonlyArray<SceneInstance>,
    effect: Extract<PipelineEffectNode, { kind: K }>,
    context: EffectApplicationContext,
  ) => SceneInstance[];
  togglesTimelineParity?: boolean;
  resolveMutedSource?: (
    effect: Extract<PipelineEffectNode, { kind: K }>,
  ) => MutedSourceDescriptor | null;
}
