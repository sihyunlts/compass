import type {
  CanonicalAnalysisResult,
  CanonicalExecutionPlan,
  BeatRange,
  SpatialRequirement,
} from './analysis/types';
import type { CompiledRackPlan } from './plan/types';

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

export interface GenerationTimelineWindow {
  start: number;
  end: number;
}

export interface GenerationOriginTimelineState {
  authored: boolean;
  window: GenerationTimelineWindow;
}

export interface GenerationCheckpoint {
  tape: LedTape;
  timelineStateByOriginId: Map<string, GenerationOriginTimelineState>;
}

export type GenerationInvalidationTargetSet = ReadonlySet<string> | 'all';
export type GenerationInvalidationFrameWindow = BeatRange | 'all' | 'none';

export interface GenerationInvalidationScope {
  affectedOriginIds: GenerationInvalidationTargetSet;
  affectedGroupIds: GenerationInvalidationTargetSet;
  outputBounds: SpatialRequirement;
  frameWindow: GenerationInvalidationFrameWindow;
}

export type LedFrameVelocityEntry = readonly [pitch: number, velocity: number];

export interface CanonicalFieldResult {
  loopLengthBeats: number;
  tape: LedTape;
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
  mutedGroupIds: ReadonlySet<string>;
  mutedGeneratorIds: ReadonlySet<string>;
  analysis: CanonicalAnalysisResult;
  executionPlan: CanonicalExecutionPlan;
  compiledPlan: CompiledRackPlan;
  checkpointsByStageId: Map<string, GenerationCheckpoint>;
}

export interface CanonicalSpatialMask {
  contains(x: number, y: number): boolean;
}

export interface CanonicalSpatialAdapter {
  createMaskFromSceneCells(cells: ReadonlyArray<LedCell>): CanonicalSpatialMask;
  createMaskFromActivationCells(cells: ReadonlyArray<LedCell>): CanonicalSpatialMask;
  createMaskFromViewportTiles(tileIds: Iterable<number>): CanonicalSpatialMask;
}
