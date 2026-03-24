import type { ClipNote } from '../shared/model';
import type { ClipNoteWithOrigin } from '../devices/color/engine';

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

export const cloneNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): ClipNoteWithOrigin[] => notes.map((note) => ({ ...note }));

export const groupNotesByOriginId = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): Map<string, ClipNoteWithOrigin[]> => {
  const notesByOriginId = new Map<string, ClipNoteWithOrigin[]>();

  for (const note of notes) {
    if (!note.originId) {
      continue;
    }

    const existing = notesByOriginId.get(note.originId);
    if (existing) {
      existing.push({ ...note });
      continue;
    }

    notesByOriginId.set(note.originId, [{ ...note }]);
  }

  return notesByOriginId;
};

export const filterNotesByOriginIds = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  originIds: ReadonlySet<string>,
): ClipNoteWithOrigin[] => notes.filter((note) =>
  note.originId ? originIds.has(note.originId) : false).map((note) => ({ ...note }));
