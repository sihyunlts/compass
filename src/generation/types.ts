import type { AffineTransform, Polyline, SceneTemporalState } from '../core/core-types';
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

export interface GeometryTimingSampleStroke {
  id: string;
  activationStepBeats?: number;
  activationSignature?: string;
}

export interface GeometryTimingSample {
  beat: number;
  strokes: GeometryTimingSampleStroke[];
}

export interface GeometrySample {
  beat: number;
  strokes: GeometryStroke[];
}

export interface GeometryTimeline {
  sampleStepBeats: number;
  timeDomainEndBeat: number;
  frames: GeometryFrame[];
  originGroupIdByOriginId: Map<string, string | null>;
  geometrySamplesByOriginId: Map<string, GeometrySample[]>;
  timingSamplesByOriginId: Map<string, GeometryTimingSample[]>;
  nextWriteId: number;
}

export interface GenerationTimelineWindow {
  start: number;
  end: number;
}

export type GenerationFinalCleanupMode = 'cleanup' | 'preserve';

export interface GenerationOriginTimelineState {
  /** Observed note-output occupancy from the most recent baked timeline. */
  observedWindow: GenerationTimelineWindow;
  /** Time range preserved by front/back cleanup and temporal source-window lookup. */
  playbackWindow: GenerationTimelineWindow;
  /** Pending temporal intent relative to the current baked source timeline. */
  temporal: SceneTemporalState;
  /** Final front/back cleanup policy for this origin. */
  finalCleanupMode: GenerationFinalCleanupMode;
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

export interface CanonicalOutputAdapter {
  createMaskFromViewportTiles(tileIds: Iterable<number>): CanonicalSpatialMask;
  /** Returns observed note-output occupancy per origin after projection and muting. */
  buildVisibleWindowByOriginId(
    timeline: GeometryTimeline,
    mutedGroupIds: ReadonlySet<string>,
    mutedGeneratorIds: ReadonlySet<string>,
  ): ReadonlyMap<string, GenerationTimelineWindow>;
}
