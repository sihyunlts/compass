import type { ClipNote, ColorEffectNode } from '../../shared/model';
import { DEFAULT_COLOR_PARAMS, sanitizeColorGapPercent } from './schema';

export interface ClipNoteWithOrigin extends ClipNote {
  originId?: string;
}

export interface ColorDeviceConfig {
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

export interface ColorTimingSegment extends TimedColorSource {
  originId: string;
}

export interface ColorTimingSampleStroke {
  id: string;
  activationStepBeats?: number;
  activationSignature?: string;
}

export interface ColorTimingSample {
  beat: number;
  strokes: ReadonlyArray<ColorTimingSampleStroke>;
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

export type ColorSlotDestinationMode = 'source-frame' | 'slot-start';

export interface ColorProgramSlot<T extends TimedColorSource = ColorTimingSegment>
  extends PlannedColorSlot<T> {
  sourceEndBeat: number;
  destinationMode: ColorSlotDestinationMode;
  useExtendedFrameWindow: boolean;
  shouldWrap: boolean;
  colorSlotGapFill: boolean;
}

export interface PlannedColorProgram<T extends TimedColorSource = ColorTimingSegment> {
  endBeat: number;
  slotsByOriginId: Map<string, ColorProgramSlot<T>[]>;
  playbackWindowByOriginId: Map<string, { start: number; end: number }>;
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

const resolveSampleActivationStepBeats = (
  strokes: ReadonlyArray<ColorTimingSampleStroke>,
  sampleStepBeats: number,
): number | null => {
  const activationStepBeats = strokes
    .map((stroke) => stroke.activationStepBeats)
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (activationStepBeats === undefined) {
    return null;
  }

  const activationStepSamples = Math.max(1, Math.round(activationStepBeats / sampleStepBeats));
  return activationStepSamples * sampleStepBeats;
};

const resolveSampleActivationSignature = (
  strokes: ReadonlyArray<ColorTimingSampleStroke>,
): string => Array.from(
  new Set(
    strokes
      .map((stroke) => stroke.activationSignature ?? `stroke:${stroke.id}`),
  ),
)
  .sort()
  .join('|');

export const buildColorTimingSegmentsByOriginId = (
  samplesByOriginId: ReadonlyMap<string, ReadonlyArray<ColorTimingSample>>,
  sampleStepBeats: number,
): Map<string, ColorTimingSegment[]> => {
  const segmentsByOriginId = new Map<string, ColorTimingSegment[]>();

  for (const [originId, sourceSamples] of samplesByOriginId.entries()) {
    const samples = [...sourceSamples].sort((left, right) => left.beat - right.beat);
    if (samples.length === 0) {
      continue;
    }

    const segments: ColorTimingSegment[] = [];
    let activeSegmentStartBeat: number | null = null;
    let activeSegmentEndBeat: number | null = null;
    let activeSignature: string | null = null;

    const signatureBySampleBeat = new Map<number, string>();
    for (const sample of samples) {
      if (resolveSampleActivationStepBeats(sample.strokes, sampleStepBeats) === null) {
        signatureBySampleBeat.set(sample.beat, resolveSampleActivationSignature(sample.strokes));
      }
    }
    const hasVaryingNonSteppedSignatures = new Set(signatureBySampleBeat.values()).size > 1;

    const flushActiveSegment = (): void => {
      if (activeSegmentStartBeat === null || activeSegmentEndBeat === null) {
        return;
      }

      segments.push({
        originId,
        startBeat: activeSegmentStartBeat,
        endBeat: activeSegmentEndBeat,
      });
    };

    for (const sample of samples) {
      const activationStepBeats = resolveSampleActivationStepBeats(sample.strokes, sampleStepBeats);
      if (activationStepBeats !== null) {
        flushActiveSegment();
        activeSegmentStartBeat = null;
        activeSegmentEndBeat = null;
        activeSignature = null;
        segments.push({
          originId,
          startBeat: sample.beat,
          endBeat: sample.beat + sampleStepBeats,
          referenceDuration: activationStepBeats,
        });
        continue;
      }

      const signature = signatureBySampleBeat.get(sample.beat) ?? '';
      if (!signature) {
        flushActiveSegment();
        activeSegmentStartBeat = null;
        activeSegmentEndBeat = null;
        activeSignature = null;
        continue;
      }

      if (hasVaryingNonSteppedSignatures) {
        flushActiveSegment();
        activeSegmentStartBeat = null;
        activeSegmentEndBeat = null;
        activeSignature = null;
        segments.push({
          originId,
          startBeat: sample.beat,
          endBeat: sample.beat + sampleStepBeats,
        });
        continue;
      }

      const sampleEndBeat = sample.beat + sampleStepBeats;
      if (
        activeSegmentStartBeat === null
        || activeSegmentEndBeat === null
        || activeSignature !== signature
        || Math.abs(sample.beat - activeSegmentEndBeat) > 1e-9
      ) {
        flushActiveSegment();
        activeSegmentStartBeat = sample.beat;
        activeSegmentEndBeat = sampleEndBeat;
        activeSignature = signature;
        continue;
      }

      activeSegmentEndBeat = sampleEndBeat;
    }

    flushActiveSegment();

    segmentsByOriginId.set(originId, segments);
  }

  return segmentsByOriginId;
};

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

const resolveNonSteppedMovingReferenceDuration = <T extends TimedColorSource>(
  sourceSegments: ReadonlyArray<T>,
  colorConfig: ColorDeviceConfig,
): number | null => {
  if (
    sourceSegments.length <= 1
    || colorConfig.velocities.length <= 1
    || sourceSegments.some((sourceSegment) => sourceSegment.referenceDuration !== undefined)
  ) {
    return null;
  }

  const firstStartBeat = sourceSegments[0].startBeat;
  const lastEndBeat = sourceSegments[sourceSegments.length - 1].endBeat;
  const sourceSpan = lastEndBeat - firstStartBeat;
  if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
    return null;
  }

  const slotCount = colorConfig.velocities.length;
  const timelineDivisions = Math.max(slotCount * 2, 14);
  const referenceDuration = sourceSpan / timelineDivisions;
  return Number.isFinite(referenceDuration) && referenceDuration > 0
    ? referenceDuration
    : null;
};

export const planColorProgramSlots = <T extends TimedColorSource>(
  sourceSegments: ReadonlyArray<T>,
  colorConfig: ColorDeviceConfig,
): PlannedColorSlot<T>[] => {
  if (sourceSegments.length === 0) {
    return [];
  }

  const referenceDuration = resolveNonSteppedMovingReferenceDuration(sourceSegments, colorConfig)
    ?? resolveMedianDuration(
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
    const sourceStepDuration = source.referenceDuration ?? timing.slotStepDuration;
    const sourceSegmentLength = Math.max(
      sourceStepDuration * (colorConfig.noteLengthPercent / 100),
      MIN_COLOR_SEGMENT,
    );
    const sourceGapDuration = Math.max(
      sourceStepDuration * (colorConfig.gapPercent / 100),
      0,
    );
    const sourceSlotStride = source.referenceDuration === undefined
      ? sourceStepDuration + sourceGapDuration
      : sourceSegmentLength + sourceGapDuration;

    for (let slotIndex = 0; slotIndex < colorConfig.velocities.length; slotIndex += 1) {
      const offset = slotIndex * sourceSlotStride;
      const startBeat = source.startBeat + offset;
      const endBeat = startBeat + sourceSegmentLength;
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

const isStaticColorSource = (
  sourceSegments: ReadonlyArray<ColorTimingSegment>,
  sampleStepBeats: number,
): boolean => {
  if (sourceSegments.length !== 1) {
    return false;
  }

  const sourceSegment = sourceSegments[0];
  return sourceSegment.referenceDuration === undefined
    && sourceSegment.endBeat - sourceSegment.startBeat > sampleStepBeats;
};

const isNonSteppedMovingColorSource = (
  sourceSegments: ReadonlyArray<ColorTimingSegment>,
): boolean => sourceSegments.length > 1
  && sourceSegments.every((sourceSegment) => sourceSegment.referenceDuration === undefined);

const hasActivationColorSlots = (
  sourceSegments: ReadonlyArray<ColorTimingSegment>,
): boolean => sourceSegments.some(
  (sourceSegment) => sourceSegment.referenceDuration !== undefined,
);

const hasExtendedColorSlots = (
  sourceSegments: ReadonlyArray<ColorTimingSegment>,
  colorConfig: { gapPercent: number },
): boolean => hasActivationColorSlots(sourceSegments)
  || (colorConfig.gapPercent > 0 && isNonSteppedMovingColorSource(sourceSegments));

const resolveColorSlotSourceEndBeat = <T extends TimedColorSource>(
  slot: PlannedColorSlot<T>,
): number => {
  if (!Number.isFinite(slot.sourceDuration) || slot.sourceDuration <= 0) {
    return slot.sourceStartBeat;
  }

  return slot.sourceStartBeat + slot.sourceDuration;
};

const resolveColorPlaybackEndBeat = <T extends TimedColorSource>(
  slots: ReadonlyArray<PlannedColorSlot<T>>,
  fallbackEndBeat: number,
): number => slots.reduce(
  (maxEndBeat, slot) => Math.max(maxEndBeat, slot.endBeat),
  fallbackEndBeat,
);

const resolveColorPlaybackWindow = <T extends TimedColorSource>(
  slots: ReadonlyArray<PlannedColorSlot<T>>,
): { start: number; end: number } | null => {
  if (slots.length === 0) {
    return null;
  }

  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const slot of slots) {
    start = Math.min(start, slot.startBeat);
    end = Math.max(end, slot.endBeat);
  }

  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { start, end }
    : null;
};

const planStaticColorProgramSlots = (
  sourceSegment: ColorTimingSegment,
  colorConfig: ColorDeviceConfig,
): ColorProgramSlot[] => {
  const slotCount = colorConfig.velocities.length;
  const sourceDuration = sourceSegment.endBeat - sourceSegment.startBeat;
  if (slotCount === 0 || !Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    return [];
  }

  const gapRatio = Math.max(colorConfig.gapPercent / 100, 0);
  const baseStepDuration = sourceDuration / (slotCount + (gapRatio * Math.max(slotCount - 1, 0)));
  if (!Number.isFinite(baseStepDuration) || baseStepDuration <= 0) {
    return [];
  }

  const gapDuration = baseStepDuration * gapRatio;
  const activeDuration = Math.min(
    Math.max(baseStepDuration * (colorConfig.noteLengthPercent / 100), 0),
    baseStepDuration,
  );

  const slots: ColorProgramSlot[] = [];
  for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
    const startBeat = sourceSegment.startBeat + slotIndex * (baseStepDuration + gapDuration);
    const endBeat = startBeat + activeDuration;
    if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || endBeat <= startBeat) {
      continue;
    }

    slots.push({
      source: sourceSegment,
      velocity: colorConfig.velocities[slotIndex],
      slotIndex,
      offset: startBeat - sourceSegment.startBeat,
      sourceStartBeat: startBeat,
      sourceEndBeat: endBeat,
      sourceDuration: endBeat - startBeat,
      startBeat,
      endBeat,
      destinationMode: 'source-frame',
      useExtendedFrameWindow: false,
      shouldWrap: false,
      colorSlotGapFill: false,
    });
  }

  return slots;
};

const planTemporalColorProgramSlots = (
  sourceSegments: ReadonlyArray<ColorTimingSegment>,
  colorConfig: ColorDeviceConfig,
): ColorProgramSlot[] => {
  const slots = planColorProgramSlots(sourceSegments, colorConfig);
  const isMovingColorSource = isNonSteppedMovingColorSource(sourceSegments);
  const useExtendedFrameWindow = hasExtendedColorSlots(sourceSegments, colorConfig);
  const shouldWrap = colorConfig.gapPercent <= 0 && isMovingColorSource;

  return slots.map((slot) => ({
    ...slot,
    sourceEndBeat: resolveColorSlotSourceEndBeat(slot),
    destinationMode: 'slot-start',
    useExtendedFrameWindow,
    shouldWrap,
    colorSlotGapFill: slot.source.referenceDuration !== undefined && colorConfig.gapPercent <= 0,
  }));
};

export const planColorProgram = (
  sourceSegmentsByOriginId: ReadonlyMap<string, ReadonlyArray<ColorTimingSegment>>,
  colorConfig: ColorDeviceConfig,
  sampleStepBeats: number,
  fallbackEndBeat: number,
): PlannedColorProgram => {
  const slotsByOriginId = new Map<string, ColorProgramSlot[]>();
  const playbackWindowByOriginId = new Map<string, { start: number; end: number }>();
  let endBeat = fallbackEndBeat;

  for (const [originId, sourceSegments] of sourceSegmentsByOriginId.entries()) {
    const isStaticSource = isStaticColorSource(sourceSegments, sampleStepBeats);
    const slots = isStaticSource
      ? planStaticColorProgramSlots(sourceSegments[0], colorConfig)
      : planTemporalColorProgramSlots(sourceSegments, colorConfig);

    slotsByOriginId.set(originId, slots);

    if (!isStaticSource && hasExtendedColorSlots(sourceSegments, colorConfig)) {
      endBeat = resolveColorPlaybackEndBeat(slots, endBeat);
      const playbackWindow = resolveColorPlaybackWindow(slots);
      if (playbackWindow) {
        playbackWindowByOriginId.set(originId, playbackWindow);
      }
    }
  }

  return {
    endBeat,
    slotsByOriginId,
    playbackWindowByOriginId,
  };
};
