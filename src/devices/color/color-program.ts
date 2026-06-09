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
  slotStepDuration: number;
  segmentLength: number;
  gapDuration: number;
}

export interface TimedColorSource {
  startBeat: number;
  endBeat: number;
  referenceDuration?: number;
}

export interface PlannedColorSlot<T extends TimedColorSource = TimedColorSource> {
  source: T;
  velocity: number;
  slotIndex: number;
  offset: number;
  sourceStartBeat: number;
  sourceDuration: number;
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
): ColorProgramTiming | null => {
  if (
    !Number.isFinite(referenceDuration)
    || referenceDuration <= 0
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

  return {
    slotStepDuration: referenceDuration,
    segmentLength: nominalSegmentLength,
    gapDuration: nominalGapDuration,
  };
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
      .map((duration, index) => sourceSegments[index].referenceDuration ?? duration)
      .filter((duration) => Number.isFinite(duration) && duration > 0),
  );
  if (referenceDuration === null) {
    return [];
  }

  const timing = resolveColorProgramTiming(colorConfig, referenceDuration);
  if (!timing) {
    return [];
  }

  const slots: PlannedColorSlot<T>[] = [];
  for (const source of sourceSegments) {
    for (let slotIndex = 0; slotIndex < colorConfig.velocities.length; slotIndex += 1) {
      const offset = slotIndex * (timing.slotStepDuration + timing.gapDuration);
      const startBeat = source.startBeat + offset;
      const endBeat = startBeat + timing.segmentLength;
      if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || endBeat <= startBeat) {
        continue;
      }

      const sourceDuration = source.endBeat - source.startBeat;
      if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
        continue;
      }

      slots.push({
        source,
        velocity: colorConfig.velocities[slotIndex],
        slotIndex,
        offset,
        sourceStartBeat: source.startBeat,
        sourceDuration,
        startBeat,
        endBeat,
      });
    }
  }

  return slots;
};
