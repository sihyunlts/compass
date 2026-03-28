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
  createLaunchpadSpatialAdapter,
  createLaunchpadSurfaceAdapter,
  projectTapeToNotes,
} from '../generation/launchpad-projection';
import type { LedFrameVelocityEntry } from '../generation/types';
import type { ClipNoteWithOrigin } from '../devices/color/color-program';

export interface GeneratedRuntimeFieldResult {
  notes: ClipNoteWithOrigin[];
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
  ledFramesBySampleIndex: ReadonlyArray<ReadonlyArray<LedFrameVelocityEntry>>;
}

const DEFAULT_SAMPLE_STEP_BEATS = 1 / NOTE_SAMPLES_PER_BEAT;

const createEmptyFieldResult = (): GeneratedRuntimeFieldResult => ({
  notes: [],
  sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  sampleStepBeats: DEFAULT_SAMPLE_STEP_BEATS,
  ledFramesBySampleIndex: [[]],
});

export const buildGeneratedFieldResultWithRuntimeMap = ({
  chain,
  loopLengthBeats,
  runtimeMap,
}: {
  chain: GenerateNotesInput['chain'];
  loopLengthBeats: number;
  runtimeMap: RuntimeMapData;
}): GeneratedRuntimeFieldResult => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return createEmptyFieldResult();
  }

  const surfaceAdapter = createLaunchpadSurfaceAdapter(runtimeMap);
  const spatialAdapter = createLaunchpadSpatialAdapter(runtimeMap);
  const generated = buildCanonicalFieldResult(
    chain,
    loopLengthBeats,
    surfaceAdapter,
    spatialAdapter,
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
  };
};

export const buildGeneratedFieldResult = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): GeneratedRuntimeFieldResult => buildGeneratedFieldResultWithRuntimeMap({
  chain,
  loopLengthBeats,
  runtimeMap: buildRuntimeMapData(launchpadModel),
});
