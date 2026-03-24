import { MIN_NOTE_DURATION } from './constants';

interface OriginWindow {
  min: number;
  max: number;
}

interface TimedNoteWithOrigin {
  pitch: number;
  channel: number;
  startBeat: number;
  durationBeats: number;
  originId?: string;
}

export interface TimelineFitResult<T extends TimedNoteWithOrigin> {
  fittedNotes: T[];
  exportTargetSpan: number;
  originWindows: Map<string, OriginWindow>;
}

const NORMALIZED_EXPORT_SPAN = 1;

const sortTimedNotes = <T extends TimedNoteWithOrigin>(notes: T[]): void => {
  notes.sort((left, right) =>
    left.startBeat - right.startBeat
    || left.pitch - right.pitch
    || left.channel - right.channel);
};

const cloneNotes = <T extends TimedNoteWithOrigin>(
  notes: ReadonlyArray<T>,
): T[] => notes.map((note) => ({ ...note }));

const computeOriginWindows = <T extends TimedNoteWithOrigin>(
  notes: ReadonlyArray<T>,
): Map<string, OriginWindow> => {
  const windows = new Map<string, OriginWindow>();

  for (const note of notes) {
    if (
      !note.originId
      || !Number.isFinite(note.startBeat)
      || !Number.isFinite(note.durationBeats)
    ) {
      continue;
    }

    const startBeat = note.startBeat;
    const endBeat = note.startBeat + Math.max(note.durationBeats, 0);
    if (!Number.isFinite(endBeat) || endBeat <= startBeat) {
      continue;
    }

    const existing = windows.get(note.originId);
    if (existing) {
      existing.min = Math.min(existing.min, startBeat);
      existing.max = Math.max(existing.max, endBeat);
    } else {
      windows.set(note.originId, { min: startBeat, max: endBeat });
    }
  }

  return windows;
};

const trimGlobalNoteSilence = <T extends TimedNoteWithOrigin>(
  notes: ReadonlyArray<T>,
): TimelineFitResult<T> => {
  if (notes.length === 0) {
    return {
      fittedNotes: [],
      exportTargetSpan: NORMALIZED_EXPORT_SPAN,
      originWindows: new Map(),
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
      fittedNotes: cloneNotes(notes),
      exportTargetSpan: NORMALIZED_EXPORT_SPAN,
      originWindows: new Map(),
    };
  }

  const fittedNotes = notes.map((note) => ({
    ...note,
    startBeat: Math.max(0, note.startBeat - firstBeat),
  }));
  sortTimedNotes(fittedNotes);

  return {
    fittedNotes,
    exportTargetSpan: Math.max(lastBeat - firstBeat, MIN_NOTE_DURATION),
    originWindows: new Map(),
  };
};

const fitNoteToWindow = <T extends TimedNoteWithOrigin>(
  note: T,
  window: OriginWindow | undefined,
): T | null => {
  if (!window) {
    return { ...note };
  }

  const span = window.max - window.min;
  if (!Number.isFinite(span) || span <= 0) {
    return { ...note };
  }

  const noteStart = Math.max(note.startBeat, window.min);
  const noteEnd = Math.min(
    note.startBeat + Math.max(note.durationBeats, 0),
    window.max,
  );
  if (!Number.isFinite(noteStart) || !Number.isFinite(noteEnd) || noteEnd <= noteStart) {
    return null;
  }

  const fittedStart = Math.max(0, (noteStart - window.min) / span);
  const fittedEnd = Math.min(1, (noteEnd - window.min) / span);
  if (!Number.isFinite(fittedStart) || !Number.isFinite(fittedEnd) || fittedEnd <= fittedStart) {
    return null;
  }

  return {
    ...note,
    startBeat: fittedStart,
    durationBeats: Math.max(fittedEnd - fittedStart, MIN_NOTE_DURATION),
  };
};

const hasAnyApplicableWindow = <T extends TimedNoteWithOrigin>(
  notes: ReadonlyArray<T>,
  originWindows: ReadonlyMap<string, OriginWindow>,
): boolean => notes.some((note) => {
  if (!note.originId) {
    return false;
  }

  const window = originWindows.get(note.originId);
  if (!window) {
    return false;
  }

  const span = window.max - window.min;
  return Number.isFinite(span) && span > 0;
});

export const fitNotesToTimeline = <T extends TimedNoteWithOrigin>(
  notes: ReadonlyArray<T>,
): TimelineFitResult<T> => {
  const originWindows = computeOriginWindows(notes);
  if (!hasAnyApplicableWindow(notes, originWindows)) {
    return trimGlobalNoteSilence(notes);
  }

  const fittedNotes = notes
    .map((note) => fitNoteToWindow(
      note,
      note.originId ? originWindows.get(note.originId) : undefined,
    ))
    .filter((note): note is T => note !== null);
  sortTimedNotes(fittedNotes);

  return {
    fittedNotes,
    exportTargetSpan: NORMALIZED_EXPORT_SPAN,
    originWindows,
  };
};
