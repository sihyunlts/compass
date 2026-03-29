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
  createLaunchpadSpatialAdapter,
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
import type { GenerationOriginTimelineState } from '../generation/types';
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

const groupNotesByOriginId = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): Map<string, ClipNoteWithOrigin[]> => {
  const notesByOriginId = new Map<string, ClipNoteWithOrigin[]>();

  for (const note of notes) {
    if (!note.originId) {
      continue;
    }

    const existing = notesByOriginId.get(note.originId);
    if (existing) {
      existing.push(note);
      continue;
    }

    notesByOriginId.set(note.originId, [note]);
  }

  return notesByOriginId;
};

const normalizeNotesToFixedLoop = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  timelineStateByOriginId: ReadonlyMap<string, GenerationOriginTimelineState>,
  loopLengthBeats: number,
): ClipNoteWithOrigin[] => {
  const notesByOriginId = groupNotesByOriginId(notes);

  return notes.map((note) => {
    const originId = note.originId;
    if (!originId) {
      return {
        ...note,
        startBeat: note.startBeat * loopLengthBeats,
        durationBeats: note.durationBeats * loopLengthBeats,
      };
    }

    const timelineState = timelineStateByOriginId.get(originId);
    const shouldPreservePlacement = timelineState?.authored === true;
    const originNotes = notesByOriginId.get(originId) ?? [];

    if (shouldPreservePlacement || originNotes.length === 0) {
      return {
        ...note,
        startBeat: note.startBeat * loopLengthBeats,
        durationBeats: note.durationBeats * loopLengthBeats,
      };
    }

    let minStartBeat = Number.POSITIVE_INFINITY;
    let maxEndBeat = Number.NEGATIVE_INFINITY;
    for (const originNote of originNotes) {
      minStartBeat = Math.min(minStartBeat, originNote.startBeat);
      maxEndBeat = Math.max(maxEndBeat, originNote.startBeat + originNote.durationBeats);
    }

    const visibleSpan = maxEndBeat - minStartBeat;
    if (!Number.isFinite(visibleSpan) || visibleSpan <= 0) {
      return {
        ...note,
        startBeat: note.startBeat * loopLengthBeats,
        durationBeats: note.durationBeats * loopLengthBeats,
      };
    }

    return {
      ...note,
      startBeat: ((note.startBeat - minStartBeat) / visibleSpan) * loopLengthBeats,
      durationBeats: (note.durationBeats / visibleSpan) * loopLengthBeats,
    };
  });
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

  const spatialAdapter = createLaunchpadSpatialAdapter(runtimeMap);
  const executionRequest = createLaunchpadExecutionRequest();
  const generated = buildCanonicalFieldResult(
    chain,
    loopLengthBeats,
    spatialAdapter,
    executionRequest,
  );
  const notes = projectTimelineToNotes(
    generated.timeline,
    runtimeMap,
    generated.mutedGroupIds,
    generated.mutedGeneratorIds,
  );
  const normalizedNotes = normalizeNotesToFixedLoop(
    notes,
    generated.timelineStateByOriginId,
    loopLengthBeats,
  );
  const frameCount = Math.max(generated.timeline.frames.length, 1);
  const sampleStepBeats = loopLengthBeats / frameCount;
  const ledFramesBySampleIndex = buildLedFramesFromNotes(
    normalizedNotes,
    frameCount,
    sampleStepBeats,
  );
  return {
    notes: normalizedNotes,
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
