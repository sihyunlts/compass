import { MIN_NOTE_DURATION, SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import { collectPitchSampledNotes } from '../core/pipeline/note-sampling';
import { evaluateTemporalRemap } from '../core/scene-operators/temporal';
import { createSampledRemapFromTimeWarpCurve } from '../core/timewarp/curve';
import type { ClipNoteWithOrigin } from '../devices/color/engine';
import type { TimeWarpCurve } from '../shared/model';
import { sortClipNotes } from './note-utils';

const isNoteActiveAtBeat = (
  note: Readonly<ClipNoteWithOrigin>,
  beat: number,
): boolean => {
  if (!Number.isFinite(note.startBeat) || !Number.isFinite(note.durationBeats)) {
    return false;
  }

  const noteEnd = note.startBeat + Math.max(note.durationBeats, 0);
  return note.startBeat <= beat && beat < noteEnd;
};

const resolveActiveByPitchAtBeat = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  beat: number,
): ReadonlyMap<number, {
  velocity: number;
  channel: number;
  originId?: string;
}> => {
  const activeByPitch = new Map<number, { velocity: number; channel: number; originId?: string }>();

  for (const note of notes) {
    if (!isNoteActiveAtBeat(note, beat)) {
      continue;
    }

    const current = activeByPitch.get(note.pitch);
    if (!current || note.velocity >= current.velocity) {
      activeByPitch.set(note.pitch, {
        velocity: note.velocity,
        channel: note.channel,
        originId: note.originId,
      });
    }
  }

  return activeByPitch;
};

export const applyNoteStageTimeWarpToNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  curve: TimeWarpCurve,
): ClipNoteWithOrigin[] => {
  if (notes.length === 0) {
    return [];
  }

  const remap = createSampledRemapFromTimeWarpCurve(curve);
  const sampleCount = Math.max(
    SAMPLES_PER_BEAT,
    remap.kind === 'sampled' ? remap.samples.length - 1 : 0,
  );
  const warped = collectPitchSampledNotes({
    sampleCount,
    endBeat: 1,
    minimumNoteDuration: MIN_NOTE_DURATION,
    resolveActiveByPitch: (outputBeat) => {
      const inputBeat = evaluateTemporalRemap(remap, outputBeat);
      if (inputBeat === null || !Number.isFinite(inputBeat)) {
        return new Map();
      }

      return resolveActiveByPitchAtBeat(notes, inputBeat);
    },
  }).map((note) => ({ ...note }));

  sortClipNotes(warped);
  return warped;
};
