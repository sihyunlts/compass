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

export interface TimedColorSource {
  startBeat: number;
  endBeat: number;
  referenceDuration?: number;
}

export type ColorTimingSegmentKind = 'stepped' | 'static' | 'sampled-moving';

export interface ColorTimingSegment extends TimedColorSource {
  originId: string;
  kind: ColorTimingSegmentKind;
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

export interface PlannedColorSlot {
  source: ColorTimingSegment;
  velocity: number;
  slotIndex: number;
  offset: number;
  sourceStartBeat: number;
  sourceDuration: number;
  startBeat: number;
  endBeat: number;
}

export type ColorSlotDestinationMode = 'source-frame' | 'slot-start';

export interface ColorProgramSlot extends PlannedColorSlot {
  sourceEndBeat: number;
  destinationMode: ColorSlotDestinationMode;
  useExtendedFrameWindow: boolean;
  shouldWrap: boolean;
  colorSlotGapFill: boolean;
}

export interface PlannedColorProgram {
  endBeat: number;
  slotsByOriginId: Map<string, ColorProgramSlot[]>;
  playbackWindowByOriginId: Map<string, { start: number; end: number }>;
}

interface ColorSourceProgression {
  planningSources: ReadonlyArray<ColorTimingSegment>;
  referenceDuration: number;
  slotPlacement: ColorSlotPlacement;
  destinationMode: ColorSlotDestinationMode;
  useSlotWindowAsSource: boolean;
  useExtendedFrameWindow: boolean;
  shouldWrap: boolean;
}

type ColorSlotPlacement =
  | { kind: 'natural' }
  | {
    kind: 'fit-source-span';
    sourceStartBeat: number;
    scale: number;
  };

const DEFAULT_COLOR_VELOCITY = DEFAULT_COLOR_PARAMS.velocities[0];
const DEFAULT_COLOR_NOTE_LENGTH_PERCENT = DEFAULT_COLOR_PARAMS.noteLengthPercent;
const MIN_COLOR_SEGMENT = 1e-4;
const COLOR_DURATION_EPSILON = 1e-9;

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
    const nonSteppedSegmentKind: ColorTimingSegmentKind = hasVaryingNonSteppedSignatures
      ? 'sampled-moving'
      : 'static';

    const flushActiveSegment = (): void => {
      if (activeSegmentStartBeat === null || activeSegmentEndBeat === null) {
        return;
      }

      segments.push({
        originId,
        kind: nonSteppedSegmentKind,
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
          kind: 'stepped',
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
          kind: 'sampled-moving',
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

const resolveStaticSourceReferenceDuration = (
  sourceSegments: ReadonlyArray<ColorTimingSegment>,
  colorConfig: ColorDeviceConfig,
): number | null => {
  if (sourceSegments.length !== 1) {
    return null;
  }

  const sourceDuration = sourceSegments[0].endBeat - sourceSegments[0].startBeat;
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    return null;
  }

  const slotCount = colorConfig.velocities.length;
  if (slotCount === 0) {
    return null;
  }

  const gapRatio = Math.max(colorConfig.gapPercent / 100, 0);
  const referenceDuration = sourceDuration / (slotCount + (gapRatio * Math.max(slotCount - 1, 0)));
  return Number.isFinite(referenceDuration) && referenceDuration > 0
    ? referenceDuration
    : null;
};

const resolveColorSourceKind = (
  sourceSegments: ReadonlyArray<ColorTimingSegment>,
): ColorTimingSegmentKind | null => {
  const sourceKinds = new Set(sourceSegments.map((sourceSegment) => sourceSegment.kind));
  if (sourceKinds.has('stepped')) {
    return 'stepped';
  }

  if (sourceKinds.has('sampled-moving')) {
    return 'sampled-moving';
  }

  return sourceKinds.has('static') ? 'static' : null;
};

const resolveSampledMovingSlotPlacement = (
  sourceSegments: ReadonlyArray<ColorTimingSegment>,
  colorConfig: ColorDeviceConfig,
  referenceDuration: number,
): ColorSlotPlacement => {
  const firstSource = sourceSegments[0];
  const lastSource = sourceSegments[sourceSegments.length - 1];
  if (!firstSource || !lastSource) {
    return { kind: 'natural' };
  }

  const sourceStartBeat = firstSource.startBeat;
  const sourceEndBeat = lastSource.endBeat;
  const sourceDuration = sourceEndBeat - sourceStartBeat;
  if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    return { kind: 'natural' };
  }

  const sourceSegmentLength = Math.max(
    referenceDuration * (colorConfig.noteLengthPercent / 100),
    MIN_COLOR_SEGMENT,
  );
  const sourceGapDuration = Math.max(
    referenceDuration * (colorConfig.gapPercent / 100),
    0,
  );
  const sourceSlotStride = referenceDuration + sourceGapDuration;
  const lastSlotEndBeat = lastSource.startBeat
    + (Math.max(colorConfig.velocities.length - 1, 0) * sourceSlotStride)
    + sourceSegmentLength;
  const destinationDuration = lastSlotEndBeat - sourceStartBeat;
  if (!Number.isFinite(destinationDuration) || destinationDuration <= sourceDuration) {
    return { kind: 'natural' };
  }

  return {
    kind: 'fit-source-span',
    sourceStartBeat,
    scale: sourceDuration / destinationDuration,
  };
};

const resolveColorReferenceDuration = (
  sourceSegments: ReadonlyArray<ColorTimingSegment>,
  colorConfig: ColorDeviceConfig,
  sourceKind: ColorTimingSegmentKind,
): number | null => {
  if (sourceSegments.length === 0) {
    return null;
  }

  if (sourceKind === 'static') {
    return resolveStaticSourceReferenceDuration(sourceSegments, colorConfig);
  }

  const sampledMovingDuration = sourceKind === 'sampled-moving'
    ? resolveNonSteppedMovingReferenceDuration(sourceSegments, colorConfig)
    : null;

  return sampledMovingDuration
    ?? resolveMedianDuration(
      sourceSegments
        .map((sourceSegment) => sourceSegment.endBeat - sourceSegment.startBeat)
        .map((duration, index) => sourceSegments[index].referenceDuration ?? duration)
        .filter((duration) => Number.isFinite(duration) && duration > 0),
    );
};

const buildColorSourceProgression = (
  sourceSegments: ReadonlyArray<ColorTimingSegment>,
  colorConfig: ColorDeviceConfig,
): ColorSourceProgression | null => {
  const sourceKind = resolveColorSourceKind(sourceSegments);
  if (sourceKind === null) {
    return null;
  }

  const referenceDuration = resolveColorReferenceDuration(
    sourceSegments,
    colorConfig,
    sourceKind,
  );
  if (referenceDuration === null) {
    return null;
  }

  const useExtendedFrameWindow = sourceKind === 'stepped'
    || (sourceKind === 'sampled-moving' && colorConfig.gapPercent > 0);
  const slotPlacement = sourceKind === 'sampled-moving'
    ? resolveSampledMovingSlotPlacement(sourceSegments, colorConfig, referenceDuration)
    : { kind: 'natural' } satisfies ColorSlotPlacement;

  return {
    planningSources: sourceSegments,
    referenceDuration,
    slotPlacement,
    destinationMode: sourceKind === 'static' ? 'source-frame' : 'slot-start',
    useSlotWindowAsSource: sourceKind === 'static',
    useExtendedFrameWindow,
    shouldWrap: false,
  };
};

const placeColorSlotBeat = (
  placement: ColorSlotPlacement,
  beat: number,
): number => {
  if (placement.kind === 'natural') {
    return beat;
  }

  return placement.sourceStartBeat + ((beat - placement.sourceStartBeat) * placement.scale);
};

const planColorProgramSlots = (
  progression: ColorSourceProgression,
  colorConfig: ColorDeviceConfig,
): ColorProgramSlot[] => {
  const slots: ColorProgramSlot[] = [];
  for (const source of progression.planningSources) {
    const sourceStepDuration = source.referenceDuration ?? progression.referenceDuration;
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
      const rawStartBeat = source.startBeat + offset;
      const rawEndBeat = rawStartBeat + sourceSegmentLength;
      const startBeat = placeColorSlotBeat(progression.slotPlacement, rawStartBeat);
      const endBeat = placeColorSlotBeat(progression.slotPlacement, rawEndBeat);
      if (!Number.isFinite(startBeat) || !Number.isFinite(endBeat) || endBeat <= startBeat) {
        continue;
      }

      const sourceStartBeat = progression.useSlotWindowAsSource
        ? startBeat
        : source.startBeat;
      const sourceEndBeat = progression.useSlotWindowAsSource
        ? sourceStartBeat + sourceSegmentLength
        : source.endBeat;
      const sourceDuration = sourceEndBeat - sourceStartBeat;
      if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) {
        continue;
      }

      slots.push({
        source,
        velocity: colorConfig.velocities[slotIndex],
        slotIndex,
        offset,
        sourceStartBeat,
        sourceEndBeat,
        sourceDuration,
        startBeat,
        endBeat,
        destinationMode: progression.destinationMode,
        useExtendedFrameWindow: progression.useExtendedFrameWindow,
        shouldWrap: progression.shouldWrap,
        colorSlotGapFill: colorConfig.gapPercent <= 0
          && (
            source.kind === 'sampled-moving'
            || (
              source.referenceDuration !== undefined
              && sourceSegmentLength + COLOR_DURATION_EPSILON >= sourceStepDuration
            )
          ),
      });
    }
  }

  return slots;
};

const resolveColorPlaybackEndBeat = (
  slots: ReadonlyArray<PlannedColorSlot>,
  fallbackEndBeat: number,
): number => slots.reduce(
  (maxEndBeat, slot) => Math.max(maxEndBeat, slot.endBeat),
  fallbackEndBeat,
);

const resolveColorPlaybackWindow = (
  slots: ReadonlyArray<PlannedColorSlot>,
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

export const planColorProgram = (
  sourceSegmentsByOriginId: ReadonlyMap<string, ReadonlyArray<ColorTimingSegment>>,
  colorConfig: ColorDeviceConfig,
  fallbackEndBeat: number,
): PlannedColorProgram => {
  const slotsByOriginId = new Map<string, ColorProgramSlot[]>();
  const playbackWindowByOriginId = new Map<string, { start: number; end: number }>();
  let endBeat = fallbackEndBeat;

  for (const [originId, sourceSegments] of sourceSegmentsByOriginId.entries()) {
    const progression = buildColorSourceProgression(
      sourceSegments,
      colorConfig,
    );
    const slots = progression
      ? planColorProgramSlots(progression, colorConfig)
      : [];

    slotsByOriginId.set(originId, slots);

    if (progression && !progression.useSlotWindowAsSource && progression.useExtendedFrameWindow) {
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
