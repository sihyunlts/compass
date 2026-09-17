import type { ClipNote } from '../shared/model';
import type { ClipNoteWithOrigin } from '../devices/color/color-program';

export const sortClipNotes = <T extends ClipNote>(notes: T[]): void => {
  notes.sort((left, right) =>
    left.startBeat - right.startBeat
    || left.pitch - right.pitch
    || left.channel - right.channel);
};

export const toClipNote = (note: ClipNoteWithOrigin): ClipNote => ({
  pitch: note.pitch,
  channel: note.channel,
  startBeat: note.startBeat,
  durationBeats: note.durationBeats,
  velocity: note.velocity,
});

export const scaleClipNoteTimes = <T extends ClipNote>(
  notes: ReadonlyArray<T>,
  ratio: number,
): T[] => notes.map((note) => ({
  ...note,
  startBeat: note.startBeat * ratio,
  durationBeats: note.durationBeats * ratio,
}));
