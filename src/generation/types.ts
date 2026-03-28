import type { Bounds } from '../core/core-types';
import type { GeneratorNode } from '../shared/model';

export interface LedCell {
  x: number;
  y: number;
  velocity: number;
  originId: string;
  originGroupId: string | null;
  writeOrder: number;
  writeId: number;
}

export interface LedFrame {
  cells: LedCell[];
}

export interface LedTape {
  sampleStepBeats: number;
  timeDomainEndBeat: number;
  frames: LedFrame[];
  nextWriteId: number;
}

export type LedFrameVelocityEntry = readonly [pitch: number, velocity: number];

export interface CanonicalFieldResult {
  tape: LedTape;
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
  mutedGroupIds: ReadonlySet<string>;
  mutedGeneratorIds: ReadonlySet<string>;
}

export interface CanonicalSurfaceAdapter {
  projectActivationTiles(cells: ReadonlyArray<LedCell>): Set<number>;
}

export interface CanonicalSpatialMask {
  contains(x: number, y: number): boolean;
}

export interface CanonicalSpatialAdapter {
  createMaskFromSceneCells(cells: ReadonlyArray<LedCell>): CanonicalSpatialMask;
  createMaskFromViewportTiles(tileIds: Iterable<number>): CanonicalSpatialMask;
  resolveGeneratorRenderBounds(device: GeneratorNode): Bounds | null;
}
