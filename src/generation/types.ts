import type { AffineTransform, Polyline } from '../core/core-types';
import type { SpatialBounds } from './analysis/types';

export interface GeometryMask {
  readonly contains: (x: number, y: number) => boolean;
  readonly inverseTransform: Readonly<AffineTransform>;
}

export interface GeometryStroke {
  readonly polyline: Polyline;
  readonly originGroupId: string | null;
  /** Stable source/copy path, shared by consecutive poses of that path. */
  readonly pathId: string;
  readonly writeOrder: number;
  readonly writeId: number;
  readonly masks: ReadonlyArray<GeometryMask>;
  readonly colorBinding?: {
    readonly layer: ColorLayer;
    readonly sourceFrame: number;
    readonly sourceEndFrameExclusive: number;
    readonly sourceOrder: number;
  };
}

/** Identity and fixed stacking order of one Color application to one origin. */
export interface ColorLayer {
  readonly order: ReadonlyArray<number>;
}

export interface GeometryPlacement {
  readonly stroke: GeometryStroke;
  readonly startFrame: number;
  readonly endFrameExclusive: number;
}

export interface GeometryTimeline {
  sampleStepBeats: number;
  timeDomainEndBeat: number;
  frameCount: number;
  /** Placement order preserves the drawing order within every sampled frame. */
  placements: GeometryPlacement[];
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
  timeline: GeometryTimeline;
  mutedGroupIds: ReadonlySet<string>;
  mutedGeneratorIds: ReadonlySet<string>;
}

export interface GenerationExecutionContext {
  generatorOutputBounds: SpatialBounds;
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
