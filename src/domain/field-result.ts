import { NOTE_SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type GenerateNotesInput,
  type RuntimeMapData,
} from './note-generation-types';
import { buildRuntimeMapData } from './runtime-map';
import { buildCanonicalFieldResult } from '../generation/engine';
import {
  projectActivePitchesToNotes,
  projectTimelineToActivePitchesBySampleIndex,
  createLaunchpadExecutionRequest,
  createLaunchpadOutputAdapter,
} from '../generation/launchpad-projection';
import type {
  CanonicalAnalysisResult,
  CanonicalExecutionPlan,
} from '../generation/analysis/types';
import type { CompiledRackPlan } from '../generation/plan/types';
import type {
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
}

const DEFAULT_SAMPLE_STEP_BEATS = 1 / NOTE_SAMPLES_PER_BEAT;

const scaleNotesToLoopLength = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  loopLengthBeats: number,
): ClipNoteWithOrigin[] => {
  return notes.map((note) => ({
    ...note,
    startBeat: note.startBeat * loopLengthBeats,
    durationBeats: note.durationBeats * loopLengthBeats,
  }));
};

const toLedFramesFromActivePitches = (
  activeByPitchFrames: ReadonlyArray<ReadonlyMap<number, { velocity: number }>>,
): ReadonlyArray<ReadonlyArray<LedFrameVelocityEntry>> => activeByPitchFrames.map((frame) => (
  Array.from(frame.entries()).map(([pitch, active]) => [pitch, active.velocity] as const)
));

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

  const outputAdapter = createLaunchpadOutputAdapter(runtimeMap);
  const executionRequest = createLaunchpadExecutionRequest();
  const generated = buildCanonicalFieldResult(
    chain,
    loopLengthBeats,
    outputAdapter,
    executionRequest,
  );
  const activeByPitchFrames = projectTimelineToActivePitchesBySampleIndex(
    generated.timeline,
    runtimeMap,
    generated.mutedGroupIds,
    generated.mutedGeneratorIds,
  );
  const notes = projectActivePitchesToNotes(
    activeByPitchFrames,
    generated.timeline,
  );
  const scaledNotes = scaleNotesToLoopLength(notes, loopLengthBeats);
  const sampleStepBeats = loopLengthBeats / Math.max(generated.timeline.frames.length, 1);
  const ledFramesBySampleIndex = toLedFramesFromActivePitches(activeByPitchFrames);
  return {
    notes: scaledNotes,
    sourceTimelineEndBeat: loopLengthBeats,
    sampleStepBeats,
    ledFramesBySampleIndex,
    analysis: generated.analysis,
    executionPlan: generated.executionPlan,
    compiledPlan: generated.compiledPlan,
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
