import type { OriginTimelinePolicy } from './origin-timeline-policy';
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

export interface TimelineNormalizationResult<T extends TimedNoteWithOrigin> {
  notes: T[];
  sourceTimelineEndBeat: number;
}

const NORMALIZED_SOURCE_TIMELINE_END_BEAT = 1;

const sortTimedNotes = <T extends TimedNoteWithOrigin>(notes: T[]): void => {
  notes.sort((left, right) =>
    left.startBeat - right.startBeat
    || left.pitch - right.pitch
    || left.channel - right.channel);
};

const cloneTimedNotes = <T extends TimedNoteWithOrigin>(
  notes: ReadonlyArray<T>,
): T[] => notes.map((note) => ({ ...note }));

const buildOriginWindows = <T extends TimedNoteWithOrigin>(
  notes: ReadonlyArray<T>,
): Map<string, OriginWindow> => {
  const originWindows = new Map<string, OriginWindow>();

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

    const existing = originWindows.get(note.originId);
    if (existing) {
      existing.min = Math.min(existing.min, startBeat);
      existing.max = Math.max(existing.max, endBeat);
      continue;
    }

    originWindows.set(note.originId, { min: startBeat, max: endBeat });
  }

  return originWindows;
};

const trimLegacyNotesToOccupiedSpan = <T extends TimedNoteWithOrigin>(
  notes: ReadonlyArray<T>,
): TimelineNormalizationResult<T> => {
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
      notes: cloneTimedNotes(notes),
      sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    };
  }

  const normalizedNotes = notes.map((note) => ({
    ...note,
    startBeat: Math.max(0, note.startBeat - firstBeat),
  }));
  sortTimedNotes(normalizedNotes);

  return {
    notes: normalizedNotes,
    sourceTimelineEndBeat: Math.max(lastBeat - firstBeat, MIN_NOTE_DURATION),
  };
};

const normalizeLegacyNoteToOriginWindow = <T extends TimedNoteWithOrigin>(
  note: T,
  originWindow: OriginWindow | undefined,
): T | null => {
  if (!originWindow) {
    return { ...note };
  }

  const originSpan = originWindow.max - originWindow.min;
  if (!Number.isFinite(originSpan) || originSpan <= 0) {
    return { ...note };
  }

  const noteStart = Math.max(note.startBeat, originWindow.min);
  const noteEnd = Math.min(
    note.startBeat + Math.max(note.durationBeats, 0),
    originWindow.max,
  );
  if (!Number.isFinite(noteStart) || !Number.isFinite(noteEnd) || noteEnd <= noteStart) {
    return null;
  }

  const normalizedStartBeat = Math.max(0, (noteStart - originWindow.min) / originSpan);
  const normalizedEndBeat = Math.min(1, (noteEnd - originWindow.min) / originSpan);
  if (
    !Number.isFinite(normalizedStartBeat)
    || !Number.isFinite(normalizedEndBeat)
    || normalizedEndBeat <= normalizedStartBeat
  ) {
    return null;
  }

  return {
    ...note,
    startBeat: normalizedStartBeat,
    durationBeats: Math.max(normalizedEndBeat - normalizedStartBeat, MIN_NOTE_DURATION),
  };
};

const normalizeLegacyNotesToOriginWindows = <T extends TimedNoteWithOrigin>(
  notes: ReadonlyArray<T>,
): TimelineNormalizationResult<T> => {
  const originWindows = buildOriginWindows(notes);
  const normalizedNotes = notes
    .map((note) => normalizeLegacyNoteToOriginWindow(
      note,
      note.originId ? originWindows.get(note.originId) : undefined,
    ))
    .filter((note): note is T => note !== null);
  sortTimedNotes(normalizedNotes);

  return {
    notes: normalizedNotes,
    sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  };
};

const hasAnyOriginWindow = <T extends TimedNoteWithOrigin>(
  notes: ReadonlyArray<T>,
): boolean => buildOriginWindows(notes).size > 0;

const clonePreservedTimelineNotes = <T extends TimedNoteWithOrigin>(
  notes: ReadonlyArray<T>,
): T[] => {
  const cloned = cloneTimedNotes(notes);
  sortTimedNotes(cloned);
  return cloned;
};

export const normalizeNotesByOriginTimelinePolicy = <T extends TimedNoteWithOrigin>(
  notes: ReadonlyArray<T>,
  originTimelinePolicyByOriginId: ReadonlyMap<string, OriginTimelinePolicy>,
): TimelineNormalizationResult<T> => {
  const preservedNotes: T[] = [];
  const legacyAutoFitNotes: T[] = [];
  const originlessNotes: T[] = [];

  for (const note of notes) {
    if (!note.originId) {
      originlessNotes.push({ ...note });
      continue;
    }

    const timelinePolicy = originTimelinePolicyByOriginId.get(note.originId);
    if (timelinePolicy === 'preserve-authored-timeline') {
      preservedNotes.push({ ...note });
    } else {
      legacyAutoFitNotes.push({ ...note });
    }
  }

  if (preservedNotes.length > 0) {
    const normalizedNotes = [
      ...clonePreservedTimelineNotes(preservedNotes),
      ...normalizeLegacyNotesToOriginWindows(legacyAutoFitNotes).notes,
      ...clonePreservedTimelineNotes(originlessNotes),
    ];
    sortTimedNotes(normalizedNotes);

    return {
      notes: normalizedNotes,
      sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    };
  }

  if (hasAnyOriginWindow(notes)) {
    return normalizeLegacyNotesToOriginWindows(notes);
  }

  return trimLegacyNotesToOccupiedSpan(notes);
};
