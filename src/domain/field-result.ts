import { NOTE_SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type GenerateNotesInput,
  type RuntimeMapData,
} from './note-generation-types';
import { buildRuntimeMapData } from './runtime-map';
import { buildCanonicalFieldResult } from '../generation/engine';
import {
  buildLedFramesBySampleIndex,
  createLaunchpadExecutionRequest,
  createLaunchpadSpatialAdapter,
  createLaunchpadSurfaceAdapter,
  projectTapeToNotes,
} from '../generation/launchpad-projection';
import type {
  CanonicalAnalysisResult,
  CanonicalExecutionPlan,
} from '../generation/analysis/types';
import type { CompiledRackPlan } from '../generation/plan/types';
import type {
  CanonicalFieldResult,
  GenerationCheckpoint,
  LedFrameVelocityEntry,
} from '../generation/types';
import type { ClipNoteWithOrigin } from '../devices/color/color-program';

export interface GeneratedRuntimeFieldResult {
  notes: ClipNoteWithOrigin[];
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
  ledFramesBySampleIndex: ReadonlyArray<ReadonlyArray<LedFrameVelocityEntry>>;
  analysis: CanonicalAnalysisResult;
  executionPlan: CanonicalExecutionPlan;
  compiledPlan: CompiledRackPlan | null;
  checkpointsByStageId: Map<string, GenerationCheckpoint>;
  canonicalResult: CanonicalFieldResult | null;
}

const DEFAULT_SAMPLE_STEP_BEATS = 1 / NOTE_SAMPLES_PER_BEAT;

const createEmptyFieldResult = (): GeneratedRuntimeFieldResult => ({
  notes: [],
  sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  sampleStepBeats: DEFAULT_SAMPLE_STEP_BEATS,
  ledFramesBySampleIndex: [[]],
  analysis: {
    byDeviceId: new Map(),
    finalOutputBounds: 'none',
    finalTimeDomain: {
      start: 0,
      end: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    },
  },
  executionPlan: {
    byDeviceId: new Map(),
    finalRequest: {
      outputBounds: 'none',
      timeDomain: {
        start: 0,
        end: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
      },
    },
  },
  compiledPlan: null,
  checkpointsByStageId: new Map(),
  canonicalResult: null,
});

export const buildGeneratedFieldResultWithRuntimeMap = ({
  chain,
  loopLengthBeats,
  runtimeMap,
  previousResult,
}: {
  chain: GenerateNotesInput['chain'];
  loopLengthBeats: number;
  runtimeMap: RuntimeMapData;
  previousResult?: GeneratedRuntimeFieldResult | null;
}): GeneratedRuntimeFieldResult => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return createEmptyFieldResult();
  }

  const surfaceAdapter = createLaunchpadSurfaceAdapter(runtimeMap);
  const spatialAdapter = createLaunchpadSpatialAdapter(runtimeMap);
  const executionRequest = createLaunchpadExecutionRequest(runtimeMap);
  const generated = buildCanonicalFieldResult(
    chain,
    loopLengthBeats,
    surfaceAdapter,
    spatialAdapter,
    executionRequest,
    previousResult?.canonicalResult,
  );
  const notes = projectTapeToNotes(
    generated.tape,
    runtimeMap,
    generated.mutedGroupIds,
    generated.mutedGeneratorIds,
  );
  const ledFramesBySampleIndex = buildLedFramesBySampleIndex(
    generated.tape,
    runtimeMap,
    generated.mutedGroupIds,
    generated.mutedGeneratorIds,
  );
  return {
    notes,
    sourceTimelineEndBeat: generated.sourceTimelineEndBeat,
    sampleStepBeats: generated.sampleStepBeats,
    ledFramesBySampleIndex,
    analysis: generated.analysis,
    executionPlan: generated.executionPlan,
    compiledPlan: generated.compiledPlan,
    checkpointsByStageId: generated.checkpointsByStageId,
    canonicalResult: generated,
  };
};

export const buildGeneratedFieldResult = ({
  chain,
  loopLengthBeats,
  launchpadModel,
  previousResult,
}: GenerateNotesInput & {
  previousResult?: GeneratedRuntimeFieldResult | null;
}): GeneratedRuntimeFieldResult => buildGeneratedFieldResultWithRuntimeMap({
  chain,
  loopLengthBeats,
  runtimeMap: buildRuntimeMapData(launchpadModel),
  previousResult,
});
