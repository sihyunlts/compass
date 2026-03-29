import type { AffineTransform, Polyline } from '../core/core-types';
import type {
  CanonicalAnalysisResult,
  CanonicalExecutionPlan,
} from './analysis/types';
import type { CompiledRackPlan } from './plan/types';

export interface GeometryMask {
  contains(x: number, y: number): boolean;
  inverseTransform: AffineTransform;
}

export interface GeometryStroke {
  polyline: Polyline;
  originGroupId: string | null;
  writeOrder: number;
  writeId: number;
  masks: GeometryMask[];
}

export interface GeometryFrame {
  strokes: GeometryStroke[];
}

export interface GeometryTimeline {
  sampleStepBeats: number;
  timeDomainEndBeat: number;
  frames: GeometryFrame[];
  nextWriteId: number;
}

export interface GenerationTimelineWindow {
  start: number;
  end: number;
}

export interface GenerationOriginTimelineState {
  authored: boolean;
  window: GenerationTimelineWindow;
}

export type LedFrameVelocityEntry = readonly [pitch: number, velocity: number];

export interface CanonicalFieldResult {
  loopLengthBeats: number;
  timeline: GeometryTimeline;
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
  mutedGroupIds: ReadonlySet<string>;
  mutedGeneratorIds: ReadonlySet<string>;
  timelineStateByOriginId: ReadonlyMap<string, GenerationOriginTimelineState>;
  analysis: CanonicalAnalysisResult;
  executionPlan: CanonicalExecutionPlan;
  compiledPlan: CompiledRackPlan;
}

export interface CanonicalSpatialMask {
  contains(x: number, y: number): boolean;
}

export interface CanonicalSpatialAdapter {
  createMaskFromViewportTiles(tileIds: Iterable<number>): CanonicalSpatialMask;
}
