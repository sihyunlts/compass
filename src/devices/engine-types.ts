import type { Bounds, GeneratorLayer, Polyline } from '../core/core-types';
import type { GeneratorEffectNode, GeneratorNode } from '../shared/types';

export type GeneratorDeviceKind = GeneratorNode['kind'];
export type PipelineEffectNode = Exclude<GeneratorEffectNode, { kind: 'color' }>;
export type PipelineEffectKind = PipelineEffectNode['kind'];

export interface GeneratorDeviceEngineHandler<
  K extends GeneratorDeviceKind = GeneratorDeviceKind,
> {
  kind: K;
  createLayer: (
    device: Extract<GeneratorNode, { kind: K }>,
    worldBounds: Bounds,
  ) => GeneratorLayer | null;
  buildPolyline: (
    layer: Extract<GeneratorLayer, { kind: K }>,
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
    layers: ReadonlyArray<GeneratorLayer>,
    effect: Extract<PipelineEffectNode, { kind: K }>,
    context: EffectApplicationContext,
  ) => GeneratorLayer[];
  togglesTimelineParity?: boolean;
  resolveMutedSource?: (
    effect: Extract<PipelineEffectNode, { kind: K }>,
  ) => MutedSourceDescriptor | null;
}
