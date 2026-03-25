import type { Bounds, Polyline, SceneInstance, SceneInstanceOfKind, TemporalVisibilityWindow } from '../core/core-types';
import type { GeneratorEffectNode, GeneratorNode } from '../shared/model';
import type { ButtonIndex } from '../core/pipeline/types';

export type GeneratorDeviceKind = GeneratorNode['kind'];
export type PipelineEffectNode = GeneratorEffectNode;
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
  buttonIndex: ButtonIndex;
  tilesOverride?: Iterable<number> | null;
  sourceTemporalWindowByOriginId?: ReadonlyMap<string, TemporalVisibilityWindow>;
  naturalTemporalWindowByEffectOriginKey?: Map<string, TemporalVisibilityWindow | null>;
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
