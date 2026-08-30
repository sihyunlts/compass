import { NOTE_SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type GenerateNotesInput,
  type RuntimeMapData,
} from './note-generation-types';
import { buildRuntimeMapData } from './runtime-map';
import { buildCanonicalFieldResult } from '../generation/engine';
import {
  createLaunchpadProjectionContext,
  projectActivePitchesToNotes,
  createLaunchpadGeneratorOutputBounds,
} from '../generation/launchpad-projection';
import type {
  LedFrameVelocityEntry,
} from '../generation/types';
import type { ClipNoteWithOrigin } from '../devices/color/color-program';

export interface GeneratedRuntimeFieldResult {
  notes: ClipNoteWithOrigin[];
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
  ledFramesBySampleIndex: ReadonlyArray<ReadonlyArray<LedFrameVelocityEntry>>;
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
});

const buildGeneratedFieldResultWithRuntimeMap = ({
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

  const projectionContext = createLaunchpadProjectionContext(runtimeMap);
  const generated = buildCanonicalFieldResult(
    chain,
    loopLengthBeats,
    projectionContext.outputAdapter,
    {
      generatorOutputBounds: createLaunchpadGeneratorOutputBounds(),
    },
  );
  const activeByPitchFrames = projectionContext.projectTimelineToActivePitchesBySampleIndex(
    generated.timeline,
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
