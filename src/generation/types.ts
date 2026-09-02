import type { AffineTransform, Polyline } from '../core/core-types';
import type { SpatialRequirement } from './analysis/types';

export interface GeometryMask {
  readonly contains: (x: number, y: number) => boolean;
  readonly inverseTransform: Readonly<AffineTransform>;
}

export interface GeometryStroke {
  readonly polyline: Polyline;
  readonly originGroupId: string | null;
  readonly writeOrder: number;
  readonly writeId: number;
  readonly masks: ReadonlyArray<GeometryMask>;
}

export interface GeometryFrame {
  strokes: GeometryStroke[];
}

export interface GeometryTimeline {
  sampleStepBeats: number;
  timeDomainEndBeat: number;
  frames: GeometryFrame[];
  originGroupIdByOriginId: Map<string, string | null>;
  nextWriteId: number;
}

export interface GenerationTimelineWindow {
  start: number;
  end: number;
}

export type GenerationTimelineDomain = 'natural' | 'fixed';

export interface GenerationOriginTimelineState {
  /** Observed note-output occupancy from the most recent baked timeline. */
  observedWindow: GenerationTimelineWindow;
  /** Explicit authored clock including gaps/tail; empty means use observed occupancy. */
  playbackExtent: GenerationTimelineWindow;
  /** Natural output is normalized once; fixed output preserves authored empty frames. */
  timelineDomain: GenerationTimelineDomain;
}

export type LedFrameVelocityEntry = readonly [pitch: number, velocity: number];

export interface CanonicalFieldResult {
  loopLengthBeats: number;
  timeline: GeometryTimeline;
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
  mutedGroupIds: ReadonlySet<string>;
  mutedGeneratorIds: ReadonlySet<string>;
}

export interface GenerationExecutionContext {
  generatorOutputBounds: SpatialRequirement;
}

export interface CanonicalSpatialMask {
  contains(x: number, y: number): boolean;
}

export interface CanonicalOutputAdapter {
  createMaskFromViewportTiles(tileIds: Iterable<number>): CanonicalSpatialMask;
  /** Returns observed note-output occupancy per origin after projection and muting. */
  buildVisibleWindowByOriginId(
    timeline: GeometryTimeline,
    mutedGroupIds: ReadonlySet<string>,
    mutedGeneratorIds: ReadonlySet<string>,
  ): ReadonlyMap<string, GenerationTimelineWindow>;
}
