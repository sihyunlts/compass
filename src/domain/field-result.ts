import { NOTE_SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type GenerateNotesInput,
  type RuntimeMapData,
} from './note-generation-types';
import { buildRuntimeMapData } from './runtime-map';
import { buildCanonicalFieldResult } from '../generation/engine';
import {
  createLaunchpadExecutionRequest,
  createLaunchpadOutputAdapter,
  projectTimelineToNotes,
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

const buildLedFramesFromNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  frameCount: number,
  sampleStepBeats: number,
): ReadonlyArray<ReadonlyArray<LedFrameVelocityEntry>> => Array.from(
  { length: Math.max(frameCount, 1) },
  (_, frameIndex) => {
    const frameStartBeat = frameIndex * sampleStepBeats;
    const frameEndBeat = frameStartBeat + sampleStepBeats;
    const activeByPitch = new Map<number, number>();

    for (const note of notes) {
      const noteEndBeat = note.startBeat + note.durationBeats;
      if (note.startBeat >= frameEndBeat || noteEndBeat <= frameStartBeat) {
        continue;
      }

      activeByPitch.set(note.pitch, note.velocity);
    }

    return Array.from(activeByPitch.entries()).map(
      ([pitch, velocity]) => [pitch, velocity] as const,
    );
  },
);

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
  const notes = projectTimelineToNotes(
    generated.timeline,
    runtimeMap,
    generated.mutedGroupIds,
    generated.mutedGeneratorIds,
  );
  const scaledNotes = scaleNotesToLoopLength(notes, loopLengthBeats);
  const frameCount = Math.max(generated.timeline.frames.length, 1);
  const sampleStepBeats = loopLengthBeats / frameCount;
  const ledFramesBySampleIndex = buildLedFramesFromNotes(
    scaledNotes,
    frameCount,
    sampleStepBeats,
  );
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
