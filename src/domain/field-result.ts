import { scalePlaybackTiming } from './playback-timing';
import { NOTE_SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type GenerateNotesInput,
  type GeneratePatternInput,
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

export const buildNormalizedFieldResult = ({
  chain,
  launchpadModel,
}: GeneratePatternInput): GeneratedRuntimeFieldResult => {
  const projectionContext = createLaunchpadProjectionContext(buildRuntimeMapData(launchpadModel));
  const generated = buildCanonicalFieldResult(
    chain,
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
  const sampleStepBeats = NORMALIZED_SOURCE_TIMELINE_END_BEAT
    / Math.max(generated.timeline.frameCount, 1);
  const ledFramesBySampleIndex = toLedFramesFromActivePitches(activeByPitchFrames);
  return {
    notes,
    sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    sampleStepBeats,
    ledFramesBySampleIndex,
  };
};

export const buildGeneratedFieldResult = ({
  loopLengthBeats,
  ...patternInput
}: GenerateNotesInput): GeneratedRuntimeFieldResult => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return createEmptyFieldResult();
  }
  return scalePlaybackTiming(buildNormalizedFieldResult(patternInput), loopLengthBeats);
};
