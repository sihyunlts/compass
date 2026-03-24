import {
  MIN_NOTE_DURATION,
  SAMPLES_PER_BEAT,
} from '../core/pipeline/constants';
import {
  compilePipelineEngine,
  evaluateExactOutputFrameAtTime,
  type CompiledPipelineEngine,
} from '../core/pipeline/engine';
import {
  applyNoteStageColorPrograms,
  type ClipNoteWithOrigin,
} from '../devices/color/engine';
import { getLaunchpadRuntimeMap } from './launchpad-model';
import type { ClipNote, GeneratorChain, LaunchpadModel } from '../shared/model';

/** Statistics summary for generated notes. */
export interface PreviewStats {
  noteCount: number;
  uniquePitchCount: number;
}

export interface GenerateNotesInput {
  chain: GeneratorChain;
  loopLengthBeats: number;
  launchpadModel?: LaunchpadModel;
}

export interface PreviewNotesData {
  notes: ClipNote[];
  sourceTimelineEndBeat: number;
}

interface OpenNoteState {
  startBeat: number;
  velocity: number;
  channel: number;
  originId?: string;
}

interface RawNotesData {
  notes: ClipNoteWithOrigin[];
}

export const NORMALIZED_SOURCE_TIMELINE_END_BEAT = 1;

const sortClipNotes = <T extends ClipNote>(notes: T[]): void => {
  notes.sort((left, right) =>
    left.startBeat - right.startBeat
    || left.pitch - right.pitch
    || left.channel - right.channel);
};

const closeOpenNote = (
  notes: ClipNoteWithOrigin[],
  pitch: number,
  open: OpenNoteState,
  endBeat: number,
): void => {
  const orderedStart = Math.max(Math.min(open.startBeat, endBeat), 0);
  const orderedEnd = Math.max(Math.max(open.startBeat, endBeat), 0);
  notes.push({
    pitch,
    channel: open.channel,
    startBeat: orderedStart,
    durationBeats: Math.max(orderedEnd - orderedStart, MIN_NOTE_DURATION),
    velocity: open.velocity,
    originId: open.originId,
  });
};

const toClipNote = (note: ClipNoteWithOrigin): ClipNote => ({
  pitch: note.pitch,
  channel: note.channel,
  startBeat: note.startBeat,
  durationBeats: note.durationBeats,
  velocity: note.velocity,
});

const trimSilenceFromNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): {
  notes: ClipNoteWithOrigin[];
  sourceTimelineEndBeat: number;
} => {
  if (notes.length === 0) {
    return {
      notes: [],
      sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    };
  }

  let firstBeat = Number.POSITIVE_INFINITY;
  let lastBeat = Number.NEGATIVE_INFINITY;
  for (const note of notes) {
    if (!Number.isFinite(note.startBeat) || !Number.isFinite(note.durationBeats)) {
      continue;
    }

    firstBeat = Math.min(firstBeat, note.startBeat);
    lastBeat = Math.max(lastBeat, note.startBeat + Math.max(note.durationBeats, 0));
  }

  if (!Number.isFinite(firstBeat) || !Number.isFinite(lastBeat) || lastBeat <= firstBeat) {
    return {
      notes: notes.map((note) => ({ ...note })),
      sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    };
  }

  const trimmedNotes = notes.map((note) => ({
    ...note,
    startBeat: Math.max(0, note.startBeat - firstBeat),
  }));
  sortClipNotes(trimmedNotes);

  return {
    notes: trimmedNotes,
    sourceTimelineEndBeat: Math.max(lastBeat - firstBeat, MIN_NOTE_DURATION),
  };
};

const buildEngine = (
  chain: GeneratorChain,
  launchpadModel: LaunchpadModel | undefined,
): CompiledPipelineEngine => {
  const runtimeMap = getLaunchpadRuntimeMap(launchpadModel);
  return compilePipelineEngine(chain, {
    buttons: runtimeMap.buttons,
    buttonIndex: runtimeMap.buttonIndex,
  });
};

const collectRawNotesData = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): RawNotesData => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return { notes: [] };
  }

  const steps = Math.round(loopLengthBeats * SAMPLES_PER_BEAT);
  if (!Number.isFinite(steps) || steps <= 0) {
    return { notes: [] };
  }

  const engine = buildEngine(chain, launchpadModel);
  const openByPitch = new Map<number, OpenNoteState>();
  const notes: ClipNoteWithOrigin[] = [];

  for (let step = 0; step < steps; step += 1) {
    const t01 = step / steps;
    const activeByPitch = evaluateExactOutputFrameAtTime(
      engine,
      t01,
    ).activationFrame.activeByPitch;

    for (const [pitch, open] of openByPitch.entries()) {
      if (activeByPitch.has(pitch)) {
        continue;
      }
      closeOpenNote(notes, pitch, open, t01);
      openByPitch.delete(pitch);
    }

    for (const [pitch, active] of activeByPitch.entries()) {
      const existing = openByPitch.get(pitch);
      if (!existing) {
        openByPitch.set(pitch, {
          startBeat: t01,
          velocity: active.velocity,
          channel: active.channel,
          originId: active.originId,
        });
        continue;
      }

      if (
        existing.velocity === active.velocity
        && existing.channel === active.channel
        && existing.originId === active.originId
      ) {
        continue;
      }

      closeOpenNote(notes, pitch, existing, t01);
      openByPitch.set(pitch, {
        startBeat: t01,
        velocity: active.velocity,
        channel: active.channel,
        originId: active.originId,
      });
    }
  }

  for (const [pitch, open] of openByPitch.entries()) {
    closeOpenNote(notes, pitch, open, NORMALIZED_SOURCE_TIMELINE_END_BEAT);
  }

  sortClipNotes(notes);
  return { notes };
};

const buildGeneratedNotes = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): {
  notes: ClipNoteWithOrigin[];
  sourceTimelineEndBeat: number;
} => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return {
      notes: [],
      sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    };
  }

  return trimSilenceFromNotes(
    applyNoteStageColorPrograms(
      chain,
      collectRawNotesData({
        chain,
        loopLengthBeats,
        launchpadModel,
      }).notes,
      MIN_NOTE_DURATION,
    ),
  );
};

/** Generates clip notes from one chain and one Launchpad model. */
export const generatePreviewNotesData = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): PreviewNotesData => {
  const generated = buildGeneratedNotes({
    chain,
    loopLengthBeats,
    launchpadModel,
  });

  return {
    notes: generated.notes.map((note) => toClipNote(note)),
    sourceTimelineEndBeat: generated.sourceTimelineEndBeat,
  };
};

/** Generates clip notes from one chain and one Launchpad model. */
export const generateNotes = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): ClipNote[] => generatePreviewNotesData({
  chain,
  loopLengthBeats,
  launchpadModel,
}).notes;

/** Counts total notes and unique pitches (deduped by pitch value). */
export const generatePreviewStats = (notes: ReadonlyArray<ClipNote>): PreviewStats => {
  const uniquePitches = new Set<number>();
  for (const note of notes) {
    uniquePitches.add(note.pitch);
  }

  return {
    noteCount: notes.length,
    uniquePitchCount: uniquePitches.size,
  };
};
