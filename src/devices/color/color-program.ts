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

interface TimedWindow {
  startBeat: number;
  endBeat: number;
}

export interface TimedColorSource {
  startBeat: number;
  endBeat: number;
}

export interface PlannedColorSlot<T extends TimedColorSource = TimedColorSource> {
  source: T;
  velocity: number;
  offset: number;
  startBeat: number;
  endBeat: number;
}

const DEFAULT_COLOR_VELOCITY = DEFAULT_COLOR_PARAMS.velocities[0];
const DEFAULT_COLOR_NOTE_LENGTH_PERCENT = DEFAULT_COLOR_PARAMS.noteLengthPercent;
const MIN_COLOR_SEGMENT = 1e-4;

const sortNumbersAscending = (left: number, right: number): number => left - right;

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

const resolveSourceSpan = <T extends TimedColorSource>(
  sourceSegments: ReadonlyArray<T>,
): number | null => {
  const sourceWindow = resolveTimedWindow(sourceSegments);
  return sourceWindow ? sourceWindow.endBeat - sourceWindow.startBeat : null;
};

const resolveTimedWindow = <T extends TimedColorSource>(
  segments: ReadonlyArray<T>,
): TimedWindow | null => {
  let startBeat = Number.POSITIVE_INFINITY;
  let endBeat = Number.NEGATIVE_INFINITY;

  for (const segment of segments) {
    startBeat = Math.min(startBeat, segment.startBeat);
    endBeat = Math.max(endBeat, segment.endBeat);
  }

  return Number.isFinite(startBeat) && Number.isFinite(endBeat) && endBeat > startBeat
    ? { startBeat, endBeat }
    : null;
};

const normalizeSlotsToSourceWindow = <T extends TimedColorSource>(
  slots: ReadonlyArray<PlannedColorSlot<T>>,
  sourceWindow: TimedWindow,
): PlannedColorSlot<T>[] => {
  const slotWindow = resolveTimedWindow(slots);
  if (!slotWindow) {
    return [];
  }

  const sourceSpan = sourceWindow.endBeat - sourceWindow.startBeat;
  const slotSpan = slotWindow.endBeat - slotWindow.startBeat;
  if (
    slotWindow.startBeat >= sourceWindow.startBeat
    && slotWindow.endBeat <= sourceWindow.endBeat
  ) {
    return [...slots];
  }
  if (!Number.isFinite(sourceSpan) || sourceSpan <= 0 || !Number.isFinite(slotSpan) || slotSpan <= 0) {
    return [...slots];
  }

  return slots.map((slot) => {
    const normalizedStart = sourceWindow.startBeat
      + (((slot.startBeat - slotWindow.startBeat) / slotSpan) * sourceSpan);
    const normalizedEnd = sourceWindow.startBeat
      + (((slot.endBeat - slotWindow.startBeat) / slotSpan) * sourceSpan);

    return {
      ...slot,
      offset: normalizedStart - slot.source.startBeat,
      startBeat: normalizedStart,
      endBeat: normalizedEnd,
    };
  });
};

export const planColorProgramSlots = <T extends TimedColorSource>(
  sourceSegments: ReadonlyArray<T>,
  colorConfig: ColorDeviceConfig,
): PlannedColorSlot<T>[] => {
  if (sourceSegments.length === 0) {
    return [];
  }

  const referenceDuration = resolveMedianDuration(
    sourceSegments
      .map((sourceSegment) => sourceSegment.endBeat - sourceSegment.startBeat)
      .filter((duration) => Number.isFinite(duration) && duration > 0),
  );
  const sourceWindow = resolveTimedWindow(sourceSegments);
  const sourceSpan = resolveSourceSpan(sourceSegments);
  if (referenceDuration === null || sourceSpan === null || sourceWindow === null) {
    return [];
  }

  const timing = resolveColorProgramTiming(colorConfig, referenceDuration, sourceSpan);
  if (!timing) {
    return [];
  }

  const slots: PlannedColorSlot<T>[] = [];
  for (const source of sourceSegments) {
    for (let slotIndex = 0; slotIndex < colorConfig.velocities.length; slotIndex += 1) {
      const offset = slotIndex * (timing.segmentLength + timing.gapDuration);
      const startBeat = source.startBeat + offset;
      const endBeat = startBeat + timing.segmentLength;
      if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || endBeat <= startBeat) {
        continue;
      }

      slots.push({
        source,
        velocity: colorConfig.velocities[slotIndex],
        offset,
        startBeat,
        endBeat,
      });
    }
  }

  return normalizeSlotsToSourceWindow(slots, sourceWindow);
};
