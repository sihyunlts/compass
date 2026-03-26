import type { ClipNote, ColorEffectNode } from '../../shared/model';
import { DEFAULT_COLOR_PARAMS, sanitizeColorGapPercent } from './schema';

export interface ClipNoteWithOrigin extends ClipNote {
  originId?: string;
}

interface ColorDeviceConfig {
  velocities: number[];
  noteLengthPercent: number;
  gapPercent: number;
}

interface ColorProgramTiming {
  segmentLength: number;
  gapDuration: number;
}

export interface PlannedColorSlot {
  sourceNote: ClipNoteWithOrigin;
  velocity: number;
  offset: number;
  startBeat: number;
  endBeat: number;
}

const DEFAULT_COLOR_VELOCITY = DEFAULT_COLOR_PARAMS.velocities[0];
const DEFAULT_COLOR_NOTE_LENGTH_PERCENT = DEFAULT_COLOR_PARAMS.noteLengthPercent;
const MIN_COLOR_SEGMENT = 1e-4;

const sortNumbersAscending = (left: number, right: number): number => left - right;

const sortClipNotes = <T extends ClipNote>(notes: T[]): void => {
  notes.sort((left, right) =>
    left.startBeat - right.startBeat
    || left.pitch - right.pitch
    || left.channel - right.channel);
};

const sanitizeColorVelocities = (velocities: readonly number[]): number[] => {
  const sanitized = velocities
    .map((slotVelocity) => Number(slotVelocity))
    .filter((slotVelocity) => Number.isFinite(slotVelocity))
    .map((slotVelocity) => Math.round(slotVelocity))
    .filter((slotVelocity) => slotVelocity >= 1 && slotVelocity <= 127);
  return sanitized.length > 0 ? sanitized : [DEFAULT_COLOR_VELOCITY];
};

const sanitizeColorNoteLengthPercent = (value: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? numeric
    : DEFAULT_COLOR_NOTE_LENGTH_PERCENT;
};

export const buildColorConfig = (
  effect: ColorEffectNode,
): ColorDeviceConfig => ({
  velocities: sanitizeColorVelocities(effect.params.velocities),
  noteLengthPercent: sanitizeColorNoteLengthPercent(effect.params.noteLengthPercent),
  gapPercent: sanitizeColorGapPercent(effect.params.gapPercent),
});

const resolveMedianDuration = (
  durations: ReadonlyArray<number>,
): number | null => {
  if (durations.length === 0) {
    return null;
  }

  const ordered = [...durations].sort(sortNumbersAscending);
  const middleIndex = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1
    ? ordered[middleIndex]
    : (ordered[middleIndex - 1] + ordered[middleIndex]) / 2;
};

const resolveColorProgramTiming = (
  colorConfig: ColorDeviceConfig,
  referenceDuration: number,
  sourceSpan: number,
): ColorProgramTiming | null => {
  if (
    !Number.isFinite(referenceDuration)
    || referenceDuration <= 0
    || !Number.isFinite(sourceSpan)
    || sourceSpan <= 0
  ) {
    return null;
  }

  const nominalSegmentLength = Math.max(
    referenceDuration * (colorConfig.noteLengthPercent / 100),
    MIN_COLOR_SEGMENT,
  );
  const nominalGapDuration = Math.max(
    referenceDuration * (colorConfig.gapPercent / 100),
    0,
  );
  const nominalProgramSpan = nominalSegmentLength
    + (Math.max(colorConfig.velocities.length - 1, 0) * (nominalSegmentLength + nominalGapDuration));
  const scale = nominalProgramSpan > sourceSpan
    ? sourceSpan / nominalProgramSpan
    : 1;

  return {
    segmentLength: nominalSegmentLength * scale,
    gapDuration: nominalGapDuration * scale,
  };
};

const resolveSourceSpan = (
  sourceNotes: ReadonlyArray<ClipNoteWithOrigin>,
): number | null => {
  let sourceStart = Number.POSITIVE_INFINITY;
  let sourceEnd = Number.NEGATIVE_INFINITY;

  for (const note of sourceNotes) {
    sourceStart = Math.min(sourceStart, note.startBeat);
    sourceEnd = Math.max(sourceEnd, note.startBeat + Math.max(note.durationBeats, 0));
  }

  return Number.isFinite(sourceStart) && Number.isFinite(sourceEnd) && sourceEnd > sourceStart
    ? sourceEnd - sourceStart
    : null;
};

export const planColorProgramSlots = (
  sourceNotes: ReadonlyArray<ClipNoteWithOrigin>,
  colorConfig: ColorDeviceConfig,
): PlannedColorSlot[] => {
  if (sourceNotes.length === 0) {
    return [];
  }

  const referenceDuration = resolveMedianDuration(
    sourceNotes
      .map((note) => note.durationBeats)
      .filter((duration) => Number.isFinite(duration) && duration > 0),
  );
  const sourceSpan = resolveSourceSpan(sourceNotes);
  if (referenceDuration === null || sourceSpan === null) {
    return [];
  }

  const timing = resolveColorProgramTiming(colorConfig, referenceDuration, sourceSpan);
  if (!timing) {
    return [];
  }

  const slots: PlannedColorSlot[] = [];
  for (const sourceNote of sourceNotes) {
    for (let slotIndex = 0; slotIndex < colorConfig.velocities.length; slotIndex += 1) {
      const offset = slotIndex * (timing.segmentLength + timing.gapDuration);
      const startBeat = sourceNote.startBeat + offset;
      const endBeat = startBeat + timing.segmentLength;
      if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || endBeat <= startBeat) {
        continue;
      }

      slots.push({
        sourceNote,
        velocity: colorConfig.velocities[slotIndex],
        offset,
        startBeat,
        endBeat,
      });
    }
  }

  return slots;
};

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

const buildNominalColorProgram = (
  sourceNotes: ReadonlyArray<ClipNoteWithOrigin>,
  colorConfig: ColorDeviceConfig,
  minimumNoteDuration: number,
): ClipNoteWithOrigin[] => planColorProgramSlots(sourceNotes, colorConfig).map((slot) => ({
  pitch: slot.sourceNote.pitch,
  channel: slot.sourceNote.channel,
  startBeat: slot.startBeat,
  durationBeats: Math.max(slot.endBeat - slot.startBeat, minimumNoteDuration),
  velocity: slot.velocity,
  originId: slot.sourceNote.originId,
}));

export const applyColorDeviceToNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  device: ColorEffectNode,
  minimumNoteDuration: number,
  targetOriginIds?: ReadonlySet<string>,
): ClipNoteWithOrigin[] => {
  if (notes.length === 0) {
    return [];
  }

  const passthrough: ClipNoteWithOrigin[] = [];
  const targetNotes: ClipNoteWithOrigin[] = [];
  for (const note of notes) {
    if (
      !note.originId
      || (targetOriginIds && !targetOriginIds.has(note.originId))
    ) {
      passthrough.push({ ...note });
      continue;
    }

    targetNotes.push(note);
  }

  const colorConfig = buildColorConfig(device);
  const colorized = Array.from(groupNotesByOriginId(targetNotes).values()).flatMap((originNotes) =>
    buildNominalColorProgram(originNotes, colorConfig, minimumNoteDuration));

  const output = [...passthrough, ...colorized];
  sortClipNotes(output);
  return output;
};
