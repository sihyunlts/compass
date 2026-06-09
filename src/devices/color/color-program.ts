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
  const uniqueVelocities = Array.from(new Set(sanitized));
  return uniqueVelocities.length > 0 ? uniqueVelocities : [DEFAULT_COLOR_VELOCITY];
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
      const offset = slotIndex * (timing.segmentLength + timing.gapDuration);
      const startBeat = source.startBeat + offset;
      const endBeat = source.endBeat + offset;
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

  return slots;
};
