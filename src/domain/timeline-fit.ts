import { MIN_NOTE_DURATION, THICKNESS } from '../core/pipeline/constants';
import {
  evaluatePolylinesAtTime,
  type CompiledPipelineEngine,
} from '../core/pipeline/engine';
import { distanceToPolylineSquared, isPointInsideClipStack } from '../core/geometry';
import type { ClipNoteWithOrigin } from '../devices/color/engine';

interface OriginWindow {
  min: number;
  max: number;
}

export interface TimelineFitResult {
  fittedNotes: ClipNoteWithOrigin[];
  exportTargetSpan: number;
  originWindows: Map<string, OriginWindow>;
}

const NORMALIZED_EXPORT_SPAN = 1;

const sortClipNotes = (notes: ClipNoteWithOrigin[]): void => {
  notes.sort((left, right) =>
    left.startBeat - right.startBeat
    || left.pitch - right.pitch
    || left.channel - right.channel);
};

const cloneNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): ClipNoteWithOrigin[] => notes.map((note) => ({ ...note }));

const computeOriginWindows = (
  engine: CompiledPipelineEngine,
  steps: number,
): Map<string, OriginWindow> => {
  const windows = new Map<string, OriginWindow>();
  const thicknessSq = THICKNESS * THICKNESS;

  for (let step = 0; step < steps; step += 1) {
    const sample = step / steps;
    const polylines = evaluatePolylinesAtTime(engine, sample);
    const activeOrigins = new Set<string>();

    for (const group of engine.buttonIndex.groups) {
      const coord = { x: group.x, y: group.y };
      for (const polyline of polylines) {
        if (
          polyline.clipStack.length > 0
          && !isPointInsideClipStack(polyline.clipStack, coord)
        ) {
          continue;
        }

        if (distanceToPolylineSquared(coord, polyline) <= thicknessSq) {
          activeOrigins.add(polyline.originId);
        }
      }
    }

    for (const originId of activeOrigins) {
      const existing = windows.get(originId);
      if (existing) {
        existing.min = Math.min(existing.min, sample);
        existing.max = Math.max(existing.max, sample);
      } else {
        windows.set(originId, { min: sample, max: sample });
      }
    }
  }

  return windows;
};

const trimGlobalNoteSilence = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
): TimelineFitResult => {
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
  sortClipNotes(fittedNotes);

  return {
    fittedNotes,
    exportTargetSpan: Math.max(lastBeat - firstBeat, MIN_NOTE_DURATION),
    originWindows: new Map(),
  };
};

const fitNoteToWindow = (
  note: ClipNoteWithOrigin,
  window: OriginWindow | undefined,
): ClipNoteWithOrigin | null => {
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

const hasAnyApplicableWindow = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
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

export const fitNotesToTimeline = (
  engine: CompiledPipelineEngine,
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  steps: number,
): TimelineFitResult => {
  const originWindows = computeOriginWindows(engine, steps);
  if (!hasAnyApplicableWindow(notes, originWindows)) {
    return trimGlobalNoteSilence(notes);
  }

  const fittedNotes = notes
    .map((note) => fitNoteToWindow(
      note,
      note.originId ? originWindows.get(note.originId) : undefined,
    ))
    .filter((note): note is ClipNoteWithOrigin => note !== null);
  sortClipNotes(fittedNotes);

  return {
    fittedNotes,
    exportTargetSpan: NORMALIZED_EXPORT_SPAN,
    originWindows,
  };
};
