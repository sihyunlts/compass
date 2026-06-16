import {
  clonePendingFrameApplications,
  type PendingColorApplication,
  type PendingFrameApplication,
  type PendingGeometryRewriteApplication,
  type MutableGenerationState,
  type PendingStrokeRewriteApplication,
  type PendingStrokeRewriteFrameWrite,
} from '../../timeline/state';
import {
  addStrokeToFrame,
  addStrokeToFrames,
  beginTimelineStage,
  completeTimelineStage,
  toFrameCount,
  toFrameWindow,
  type FrameWindow,
} from '../../timeline';
import {
  mergeTimelineWindows,
  type TimelineWindow,
} from '../../timeline/temporal-window';
import {
  planColorProgramSlots,
  type ColorDeviceConfig,
  type PlannedColorSlot,
  type TimedColorSource,
} from '../../../devices/color/color-program';
import type { CanonicalOutputAdapter } from '../../types';
import {
  buildTargetOriginIds,
  buildSourceStrokesByOriginAndFrame,
  cloneStrokeWithVelocityAndWriteOrder,
  resolveColorSlotDestinationFrameIndexes,
  resolveColorSlotWriteOrder,
  stripOriginFrames,
} from './timeline-strokes';
import { buildTimelineStateByOriginId } from './timeline-state';
import type { GeometryStroke, GeometryTimeline } from '../../types';
import { materializeTemporalCheckpointTimeline } from './pending-temporal';
import type { PendingFrameApplicationOperatorInput } from './types';
import { isFrameWithinWindow, resolveFrameWindow } from './frame-window';
import {
  applyFinalCleanupModeUpdate,
  transitionGenerationState,
  type FinalCleanupModeUpdate,
  type GenerationStateTransitionOverrides,
} from './state-transition';

const mergePlaybackWindowOverrides = (
  playbackWindowOverrideMaps: ReadonlyArray<ReadonlyMap<string, TimelineWindow>>,
): Map<string, TimelineWindow> => {
  const overrides = new Map<string, TimelineWindow>();

  for (const playbackWindowOverrideMap of playbackWindowOverrideMaps) {
    for (const [originId, playbackWindow] of playbackWindowOverrideMap.entries()) {
      overrides.set(
        originId,
        mergeTimelineWindows(overrides.get(originId), playbackWindow),
      );
    }
  }

  return overrides;
};

interface ColorSourceSnapshot {
  targetOriginIds: Set<string>;
  sourceStrokesByOriginAndFrame: Map<string, Map<number, GeometryStroke[]>>;
  frameCount: number;
  timeDomainEndBeat: number;
}

interface PendingColorFrameWrite {
  sourceStrokes: ReadonlyArray<GeometryStroke>;
  destinationFrameIndexes: ReadonlyArray<number>;
  velocity: number;
  writeOrder: number;
  slotIndex: number;
  slotCount: number;
  colorSlotGapFill: boolean;
}

interface ColorTimingSegment extends TimedColorSource {
  originId: string;
}

const buildSourceFrameIndexesByOriginId = (
  sourceStrokesByOriginAndFrame: ReadonlyMap<string, ReadonlyMap<number, ReadonlyArray<GeometryStroke>>>,
): Map<string, number[]> => new Map(
  Array.from(sourceStrokesByOriginAndFrame.entries(), ([originId, frameMap]) => [
    originId,
    Array.from(frameMap.keys()).sort((left, right) => left - right),
  ]),
);

const resolveFrameActivationStepBeats = (
  strokes: ReadonlyArray<GeometryStroke>,
  sampleStepBeats: number,
): number | null => {
  const activationStepBeats = strokes
    .map((stroke) => stroke.polyline.activationStepBeats)
    .find((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0);
  if (activationStepBeats === undefined) {
    return null;
  }

  const activationStepFrames = Math.max(1, Math.round(activationStepBeats / sampleStepBeats));
  return activationStepFrames * sampleStepBeats;
};

const resolveFrameActivationSignature = (
  strokes: ReadonlyArray<GeometryStroke>,
): string => Array.from(
  new Set(
    strokes
      .map((stroke) => stroke.polyline.activationSignature ?? `stroke:${stroke.writeId}`),
  ),
)
  .sort()
  .join('|');

export const buildSourceTimingSegmentsByOriginId = (
  sourceStrokesByOriginAndFrame: ReadonlyMap<string, ReadonlyMap<number, ReadonlyArray<GeometryStroke>>>,
  sampleStepBeats: number,
): Map<string, ColorTimingSegment[]> => {
  const segmentsByOriginId = new Map<string, ColorTimingSegment[]>();

  for (const [originId, frameMap] of sourceStrokesByOriginAndFrame.entries()) {
    const frameIndexes = Array.from(frameMap.keys()).sort((left, right) => left - right);
    if (frameIndexes.length === 0) {
      continue;
    }

    const segments: ColorTimingSegment[] = [];
    let activeSegmentStartFrame: number | null = null;
    let activeSegmentEndFrameExclusive: number | null = null;
    let activeSignature: string | null = null;

    const signatureByFrameIndex = new Map<number, string>();
    for (const frameIndex of frameIndexes) {
      const frameStrokes = frameMap.get(frameIndex) ?? [];
      if (resolveFrameActivationStepBeats(frameStrokes, sampleStepBeats) === null) {
        signatureByFrameIndex.set(frameIndex, resolveFrameActivationSignature(frameStrokes));
      }
    }
    const hasVaryingNonSteppedSignatures = new Set(signatureByFrameIndex.values()).size > 1;

    const flushActiveSegment = (): void => {
      if (activeSegmentStartFrame === null || activeSegmentEndFrameExclusive === null) {
        return;
      }

      segments.push({
        originId,
        startBeat: activeSegmentStartFrame * sampleStepBeats,
        endBeat: activeSegmentEndFrameExclusive * sampleStepBeats,
      });
    };

    for (const frameIndex of frameIndexes) {
      const frameStrokes = frameMap.get(frameIndex) ?? [];
      const activationStepBeats = resolveFrameActivationStepBeats(frameStrokes, sampleStepBeats);
      if (activationStepBeats !== null) {
        flushActiveSegment();
        activeSegmentStartFrame = null;
        activeSegmentEndFrameExclusive = null;
        activeSignature = null;
        const startBeat = frameIndex * sampleStepBeats;
        segments.push({
          originId,
          startBeat,
          endBeat: startBeat + sampleStepBeats,
          referenceDuration: activationStepBeats,
        });
        continue;
      }

      const signature = signatureByFrameIndex.get(frameIndex) ?? '';
      if (!signature) {
        flushActiveSegment();
        activeSegmentStartFrame = null;
        activeSegmentEndFrameExclusive = null;
        activeSignature = null;
        continue;
      }

      if (hasVaryingNonSteppedSignatures) {
        flushActiveSegment();
        activeSegmentStartFrame = null;
        activeSegmentEndFrameExclusive = null;
        activeSignature = null;
        segments.push({
          originId,
          startBeat: frameIndex * sampleStepBeats,
          endBeat: (frameIndex + 1) * sampleStepBeats,
        });
        continue;
      }

      if (
        activeSegmentStartFrame === null
        || activeSegmentEndFrameExclusive === null
        || activeSignature !== signature
        || frameIndex !== activeSegmentEndFrameExclusive
      ) {
        flushActiveSegment();
        activeSegmentStartFrame = frameIndex;
        activeSegmentEndFrameExclusive = frameIndex + 1;
        activeSignature = signature;
        continue;
      }

      activeSegmentEndFrameExclusive = frameIndex + 1;
    }

    flushActiveSegment();

    segmentsByOriginId.set(originId, segments);
  }

  return segmentsByOriginId;
};

const resolveColorSlotSourceEndBeat = <T extends TimedColorSource>(
  slot: PlannedColorSlot<T>,
): number => {
  if (!Number.isFinite(slot.sourceDuration) || slot.sourceDuration <= 0) {
    return slot.sourceStartBeat;
  }

  return slot.sourceStartBeat + slot.sourceDuration;
};

const resolveColorSlotSourceFrameWindow = <T extends TimedColorSource>(
  slot: PlannedColorSlot<T>,
  sampleStepBeats: number,
  frameCount: number,
): FrameWindow => {
  const startBeat = slot.sourceStartBeat;
  const endBeat = resolveColorSlotSourceEndBeat(slot);
  const startFrame = Math.min(
    Math.max(Math.round(startBeat / sampleStepBeats), 0),
    frameCount,
  );
  const endFrameExclusive = Math.min(
    Math.max(Math.ceil((endBeat / sampleStepBeats) - 1e-9), startFrame),
    frameCount,
  );

  return {
    startFrame,
    endFrameExclusive,
  };
};

const resolveColorSlotDestinationFrameWindow = <T extends TimedColorSource>(
  slot: PlannedColorSlot<T>,
  sampleStepBeats: number,
  frameCount: number,
): FrameWindow => {
  if (slot.source.referenceDuration === undefined) {
    return toFrameWindow(
      {
        start: slot.startBeat,
        end: slot.endBeat,
      },
      sampleStepBeats,
      frameCount,
    );
  }

  const segmentDuration = slot.endBeat - slot.startBeat;
  const extraDuration = Math.max(segmentDuration - slot.source.referenceDuration, 0);
  return toFrameWindow(
    {
      start: slot.startBeat,
      end: slot.startBeat + sampleStepBeats + extraDuration,
    },
    sampleStepBeats,
    frameCount,
  );
};

const resolveColorDestinationFrameIndex = (
  slotStartBeat: number,
  sampleStepBeats: number,
): number => Math.round(
  slotStartBeat / sampleStepBeats,
);

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

const resolveStaticColorSlotAtFrame = (
  sourceSegment: ColorTimingSegment,
  frameIndex: number,
  sampleStepBeats: number,
  colorConfig: ColorDeviceConfig,
): { velocity: number; slotIndex: number; slotCount: number } | null => {
  const slotCount = colorConfig.velocities.length;
  const sourceDuration = sourceSegment.endBeat - sourceSegment.startBeat;
  if (slotCount === 0 || !Number.isFinite(sourceDuration) || sourceDuration <= 0) {
    return null;
  }

  const gapRatio = Math.max(colorConfig.gapPercent / 100, 0);
  const baseStepDuration = sourceDuration / (slotCount + (gapRatio * Math.max(slotCount - 1, 0)));
  if (!Number.isFinite(baseStepDuration) || baseStepDuration <= 0) {
    return null;
  }

  const gapDuration = baseStepDuration * gapRatio;
  const activeDuration = Math.min(
    Math.max(baseStepDuration * (colorConfig.noteLengthPercent / 100), 0),
    baseStepDuration,
  );
  const relativeBeat = (frameIndex * sampleStepBeats) - sourceSegment.startBeat;
  for (let slotIndex = 0; slotIndex < slotCount; slotIndex += 1) {
    const slotStartBeat = slotIndex * (baseStepDuration + gapDuration);
    const slotEndBeat = slotStartBeat + activeDuration;
    if (relativeBeat >= slotStartBeat && relativeBeat < slotEndBeat) {
      return {
        velocity: colorConfig.velocities[slotIndex],
        slotIndex,
        slotCount,
      };
    }
  }

  return null;
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

const resolveColorPlaybackEndBeat = <T extends TimedColorSource>(
  slots: ReadonlyArray<PlannedColorSlot<T>>,
  fallbackEndBeat: number,
): number => slots.reduce(
  (maxEndBeat, slot) => Math.max(maxEndBeat, slot.endBeat),
  fallbackEndBeat,
);

const resolveColorPlaybackWindow = <T extends TimedColorSource>(
  slots: ReadonlyArray<PlannedColorSlot<T>>,
): TimelineWindow | null => {
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

type PendingFrameApplicationDraft =
  | Omit<PendingColorApplication, 'precedingTemporalCheckpoint'>
  | Omit<PendingGeometryRewriteApplication, 'precedingTemporalCheckpoint'>
  | Omit<PendingStrokeRewriteApplication, 'precedingTemporalCheckpoint'>;
type PendingColorProgramApplication = Omit<PendingColorApplication, 'precedingTemporalCheckpoint'>;

type PendingFrameApplicationAppendInput = Pick<
  PendingFrameApplicationOperatorInput,
  'baseState' | 'precedingTemporalCheckpoint'
>;

const attachTemporalCheckpoint = (
  input: PendingFrameApplicationAppendInput,
  application: PendingFrameApplicationDraft,
): PendingFrameApplication => ({
  ...application,
  precedingTemporalCheckpoint: input.precedingTemporalCheckpoint,
});

export const appendPendingFrameApplication = (
  input: PendingFrameApplicationAppendInput,
  application: PendingFrameApplicationDraft,
  options: {
    timelineStateByOriginId?: MutableGenerationState['timelineStateByOriginId'];
    finalCleanupModeUpdate?: FinalCleanupModeUpdate;
  } = {},
): MutableGenerationState => {
  const state = input.baseState;
  const pendingFrameApplications = clonePendingFrameApplications(state.pendingFrameApplications);
  if (application.targetOriginIds.size > 0) {
    pendingFrameApplications.push(attachTemporalCheckpoint(input, application));
  }

  const timelineStateByOriginId = options.finalCleanupModeUpdate
    ? applyFinalCleanupModeUpdate(
        options.timelineStateByOriginId ?? state.timelineStateByOriginId,
        options.finalCleanupModeUpdate,
      )
    : options.timelineStateByOriginId;
  const overrides: GenerationStateTransitionOverrides = {
    pendingFrameApplications,
  };
  if (timelineStateByOriginId) {
    overrides.timelineStateByOriginId = timelineStateByOriginId;
  }

  return transitionGenerationState(state, overrides);
};

export const buildColorSourceSnapshot = (
  timeline: GeometryTimeline,
  targetGroupId: string | null,
  options: {
    excludeMutedSources: boolean;
    mutedGroupIds: ReadonlySet<string>;
    mutedGeneratorIds: ReadonlySet<string>;
  },
): ColorSourceSnapshot => {
  const targetOriginIds = buildTargetOriginIds(
    timeline,
    targetGroupId,
    options,
  );
  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    timeline,
    targetOriginIds,
  );

  return {
    targetOriginIds,
    sourceStrokesByOriginAndFrame,
    frameCount: timeline.frames.length,
    timeDomainEndBeat: timeline.timeDomainEndBeat,
  };
};

export const appendPendingStrokeRewriteApplication = (
  input: PendingFrameApplicationOperatorInput,
  targetOriginIds: ReadonlySet<string>,
  writes: ReadonlyArray<PendingStrokeRewriteFrameWrite>,
  finalCleanupModeUpdate: FinalCleanupModeUpdate,
): MutableGenerationState => {
  return appendPendingFrameApplication(
    input,
    {
      kind: 'stroke-rewrite',
      targetOriginIds: new Set(targetOriginIds),
      sourceFrameCount: input.sourceState.timeline.frames.length,
      endBeat: input.sourceState.timeline.timeDomainEndBeat,
      writes,
    },
    { finalCleanupModeUpdate },
  );
};

export const appendPendingGeometryRewriteApplication = (
  input: PendingFrameApplicationAppendInput,
  targetOriginIds: ReadonlySet<string>,
  requiredFrameWindow: PendingGeometryRewriteApplication['requiredFrameWindow'],
  rewriteFrameStrokes: PendingGeometryRewriteApplication['rewriteFrameStrokes'],
  finalCleanupModeUpdate: FinalCleanupModeUpdate,
): MutableGenerationState => {
  return appendPendingFrameApplication(
    input,
    {
      kind: 'geometry-rewrite',
      targetOriginIds: new Set(targetOriginIds),
      requiredFrameWindow,
      rewriteFrameStrokes,
    },
    { finalCleanupModeUpdate },
  );
};

export const appendPendingColorApplication = (
  input: PendingFrameApplicationAppendInput,
  application: Omit<PendingColorApplication, 'kind' | 'precedingTemporalCheckpoint'>,
  options: {
    timelineStateByOriginId?: MutableGenerationState['timelineStateByOriginId'];
    finalCleanupModeUpdate: FinalCleanupModeUpdate;
  },
): MutableGenerationState => appendPendingFrameApplication(
  input,
  {
    kind: 'color',
    ...application,
  },
  options,
);

export const buildPendingStrokeRewriteFrameWrites = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
  frameWindow: FrameWindow,
  rewriteFrameStrokes: (
    frameIndex: number,
    strokes: ReadonlyArray<GeometryStroke>,
  ) => ReadonlyArray<Omit<GeometryStroke, 'writeId'>>,
): PendingStrokeRewriteFrameWrite[] => {
  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    timeline,
    targetOriginIds,
  );
  const writes: PendingStrokeRewriteFrameWrite[] = [];

  for (
    let frameIndex = frameWindow.startFrame;
    frameIndex < frameWindow.endFrameExclusive;
    frameIndex += 1
  ) {
    const sourceStrokes = Array.from(targetOriginIds).flatMap((originId) => (
      sourceStrokesByOriginAndFrame.get(originId)?.get(frameIndex) ?? []
    ));
    if (sourceStrokes.length === 0) {
      continue;
    }

    const strokes = rewriteFrameStrokes(frameIndex, sourceStrokes);
    if (strokes.length === 0) {
      continue;
    }

    writes.push({
      destinationFrameIndex: frameIndex,
      strokes,
    });
  }

  return writes;
};

type PendingFrameApplicationStage = ReturnType<typeof beginTimelineStage>;
interface PendingFrameApplicationStageInput {
  targetOriginIds: ReadonlySet<string>;
  sourceFrameCount: number;
  endBeat: number;
}

const isFrameIndexWithinTimeline = (
  timeline: GeometryTimeline,
  frameIndex: number,
): boolean => frameIndex >= 0 && frameIndex < timeline.frames.length;

const filterFrameIndexesWithinTimeline = (
  timeline: GeometryTimeline,
  frameIndexes: ReadonlyArray<number>,
): number[] => frameIndexes.filter((frameIndex) => isFrameIndexWithinTimeline(timeline, frameIndex));

const materializePendingFrameApplicationStage = (
  timeline: GeometryTimeline,
  application: PendingFrameApplicationStageInput,
  applyWrites: (timeline: PendingFrameApplicationStage) => void,
): GeometryTimeline => {
  const nextTimeline = beginTimelineStage(
    timeline,
    Math.max(timeline.timeDomainEndBeat, application.endBeat),
  );
  stripOriginFrames(
    nextTimeline,
    Math.min(application.sourceFrameCount, nextTimeline.frames.length),
    application.targetOriginIds,
  );

  applyWrites(nextTimeline);

  return completeTimelineStage(nextTimeline);
};

const materializePendingStrokeRewriteApplication = (
  timeline: GeometryTimeline,
  application: Extract<PendingFrameApplication, { kind: 'stroke-rewrite' }>,
): GeometryTimeline => materializePendingFrameApplicationStage(timeline, application, (nextTimeline) => {
  for (const write of application.writes) {
    if (!isFrameIndexWithinTimeline(nextTimeline, write.destinationFrameIndex)) {
      continue;
    }

    for (const stroke of write.strokes) {
      addStrokeToFrame(nextTimeline, write.destinationFrameIndex, stroke);
    }
  }
});

const materializePendingGeometryRewriteApplication = (
  timeline: GeometryTimeline,
  application: Extract<PendingFrameApplication, { kind: 'geometry-rewrite' }>,
): GeometryTimeline => {
  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    timeline,
    application.targetOriginIds,
  );
  const frameWindow = resolveFrameWindow(
    application.requiredFrameWindow,
    timeline.sampleStepBeats,
    timeline.frames.length,
  );

  return materializePendingFrameApplicationStage(
    timeline,
    {
      targetOriginIds: application.targetOriginIds,
      sourceFrameCount: timeline.frames.length,
      endBeat: timeline.timeDomainEndBeat,
    },
    (nextTimeline) => {
      for (
        let frameIndex = frameWindow.startFrame;
        frameIndex < frameWindow.endFrameExclusive;
        frameIndex += 1
      ) {
        const sourceStrokes = Array.from(application.targetOriginIds).flatMap((originId) => (
          sourceStrokesByOriginAndFrame.get(originId)?.get(frameIndex) ?? []
        ));
        if (sourceStrokes.length === 0) {
          continue;
        }

        const rewrittenStrokes = application.rewriteFrameStrokes({
          timeline,
          frameIndex,
          strokes: sourceStrokes,
        });
        for (const stroke of rewrittenStrokes) {
          addStrokeToFrame(nextTimeline, frameIndex, stroke);
        }
      }
    },
  );
};

interface PendingFrameApplicationMaterialization {
  timeline: GeometryTimeline;
  playbackWindowByOriginId?: ReadonlyMap<string, TimelineWindow>;
}

const buildPendingColorFrameWrites = (
  timeline: GeometryTimeline,
  application: PendingColorProgramApplication,
): {
  colorTimelineEndBeat: number;
  playbackWindowByOriginId: Map<string, TimelineWindow>;
  writes: PendingColorFrameWrite[];
} => {
  const sourceSnapshot = {
    targetOriginIds: new Set(application.targetOriginIds),
    sourceStrokesByOriginAndFrame: buildSourceStrokesByOriginAndFrame(
      timeline,
      application.targetOriginIds,
    ),
    frameCount: timeline.frames.length,
    timeDomainEndBeat: timeline.timeDomainEndBeat,
  };
  const frameWindow = resolveFrameWindow(
    application.requiredFrameWindow,
    timeline.sampleStepBeats,
    sourceSnapshot.frameCount,
  );
  const targetSegmentsByOriginId = buildSourceTimingSegmentsByOriginId(
    sourceSnapshot.sourceStrokesByOriginAndFrame,
    timeline.sampleStepBeats,
  );
  const sourceFrameIndexesByOriginId = buildSourceFrameIndexesByOriginId(
    sourceSnapshot.sourceStrokesByOriginAndFrame,
  );
  const colorSlotsByOriginId = new Map<string, PlannedColorSlot<ColorTimingSegment>[]>();
  let colorTimelineEndBeat = sourceSnapshot.timeDomainEndBeat;

  for (const [originId, sourceSegments] of targetSegmentsByOriginId.entries()) {
    if (isStaticColorSource(sourceSegments, timeline.sampleStepBeats)) {
      continue;
    }

    const slots = planColorProgramSlots(sourceSegments, application.colorConfig);
    colorSlotsByOriginId.set(originId, slots);
    if (hasExtendedColorSlots(sourceSegments, application.colorConfig)) {
      colorTimelineEndBeat = resolveColorPlaybackEndBeat(slots, colorTimelineEndBeat);
    }
  }

  const colorFrameCount = toFrameCount(colorTimelineEndBeat, timeline.sampleStepBeats);
  const writes: PendingColorFrameWrite[] = [];
  const playbackWindowByOriginId = new Map<string, TimelineWindow>();

  for (const [originId, sourceSegments] of targetSegmentsByOriginId.entries()) {
    const sourceStrokesByFrame = sourceSnapshot.sourceStrokesByOriginAndFrame.get(originId);
    const sourceFrameIndexes = sourceFrameIndexesByOriginId.get(originId);
    if (!sourceStrokesByFrame || !sourceFrameIndexes || sourceFrameIndexes.length === 0) {
      continue;
    }

    if (isStaticColorSource(sourceSegments, timeline.sampleStepBeats)) {
      const staticSourceSegment = sourceSegments[0];
      for (const sourceFrameIndex of sourceFrameIndexes) {
        if (!isFrameWithinWindow(sourceFrameIndex, frameWindow)) {
          continue;
        }

        const staticSlot = resolveStaticColorSlotAtFrame(
          staticSourceSegment,
          sourceFrameIndex,
          timeline.sampleStepBeats,
          application.colorConfig,
        );
        if (!staticSlot) {
          continue;
        }

        const sourceStrokes = sourceStrokesByFrame.get(sourceFrameIndex);
        if (!sourceStrokes || sourceStrokes.length === 0) {
          continue;
        }

        for (const stroke of sourceStrokes) {
          writes.push({
            sourceStrokes: [stroke],
            destinationFrameIndexes: [sourceFrameIndex],
            velocity: staticSlot.velocity,
            writeOrder: resolveColorSlotWriteOrder(
              application.writeOrder,
              staticSlot.slotIndex,
              staticSlot.slotCount,
            ),
            slotIndex: staticSlot.slotIndex,
            slotCount: staticSlot.slotCount,
            colorSlotGapFill: false,
          });
        }
      }

      continue;
    }

    const slots = colorSlotsByOriginId.get(originId) ?? [];
    if (slots.length === 0) {
      continue;
    }

    const isMovingColorSource = isNonSteppedMovingColorSource(sourceSegments);
    const hasExtendedSlots = hasExtendedColorSlots(sourceSegments, application.colorConfig);
    const colorFrameWindow = hasExtendedSlots
      ? resolveFrameWindow('all', timeline.sampleStepBeats, colorFrameCount)
      : frameWindow;
    if (hasExtendedSlots) {
      const playbackWindow = resolveColorPlaybackWindow(slots);
      if (playbackWindow) {
        playbackWindowByOriginId.set(originId, playbackWindow);
      }
    }

    const shouldWrapColorSlots = application.colorConfig.gapPercent <= 0
      && isMovingColorSource;
    for (const slot of slots) {
      const sourceFrameWindow = resolveColorSlotSourceFrameWindow(
        slot,
        timeline.sampleStepBeats,
        sourceSnapshot.frameCount,
      );
      const destinationFrameWindow = resolveColorSlotDestinationFrameWindow(
        slot,
        timeline.sampleStepBeats,
        colorFrameCount,
      );

      for (const sourceFrameIndex of sourceFrameIndexes) {
        if (sourceFrameIndex < sourceFrameWindow.startFrame) {
          continue;
        }
        if (sourceFrameIndex >= sourceFrameWindow.endFrameExclusive) {
          break;
        }

        const destinationFrameIndex = resolveColorDestinationFrameIndex(
          slot.startBeat,
          timeline.sampleStepBeats,
        );
        const destinationFrameIndexes = resolveColorSlotDestinationFrameIndexes(
          slot.source,
          destinationFrameIndex,
          destinationFrameWindow,
          colorFrameCount,
          shouldWrapColorSlots,
        );

        const sourceStrokes = sourceStrokesByFrame.get(sourceFrameIndex);
        if (!sourceStrokes || sourceStrokes.length === 0) {
          continue;
        }

        const resolvedDestinationFrameIndexes = destinationFrameIndexes.filter((resolvedDestinationFrameIndex) => (
          isFrameWithinWindow(resolvedDestinationFrameIndex, colorFrameWindow)
          && (
            shouldWrapColorSlots
            || (
              resolvedDestinationFrameIndex >= destinationFrameWindow.startFrame
              && resolvedDestinationFrameIndex < destinationFrameWindow.endFrameExclusive
            )
          )
        ));
        if (resolvedDestinationFrameIndexes.length === 0) {
          continue;
        }

        writes.push({
          sourceStrokes,
          destinationFrameIndexes: resolvedDestinationFrameIndexes,
          velocity: slot.velocity,
          writeOrder: resolveColorSlotWriteOrder(
            application.writeOrder,
            slot.slotIndex,
            application.colorConfig.velocities.length,
          ),
          slotIndex: slot.slotIndex,
          slotCount: application.colorConfig.velocities.length,
          colorSlotGapFill: slot.source.referenceDuration !== undefined
            && application.colorConfig.gapPercent <= 0,
        });
      }
    }
  }

  return {
    colorTimelineEndBeat,
    playbackWindowByOriginId,
    writes,
  };
};

export const resolvePendingColorPlaybackWindowOverrides = (
  timeline: GeometryTimeline,
  application: PendingColorProgramApplication,
): Map<string, TimelineWindow> => buildPendingColorFrameWrites(
  timeline,
  application,
).playbackWindowByOriginId;

const materializePendingColorApplication = (
  timeline: GeometryTimeline,
  application: Extract<PendingFrameApplication, { kind: 'color' }>,
): PendingFrameApplicationMaterialization => {
  const colorProgram = buildPendingColorFrameWrites(timeline, application);
  const nextTimeline = materializePendingFrameApplicationStage(
    timeline,
    {
      targetOriginIds: application.targetOriginIds,
      sourceFrameCount: timeline.frames.length,
      endBeat: colorProgram.colorTimelineEndBeat,
    },
    (timelineStage) => {
      for (const write of colorProgram.writes) {
        const destinationFrameIndexes = filterFrameIndexesWithinTimeline(
          timelineStage,
          write.destinationFrameIndexes,
        );
        if (destinationFrameIndexes.length === 0) {
          continue;
        }

        for (const stroke of write.sourceStrokes) {
          addStrokeToFrames(
            timelineStage,
            destinationFrameIndexes,
            cloneStrokeWithVelocityAndWriteOrder(
              stroke,
              write.velocity,
              write.writeOrder,
              write.slotIndex,
              write.slotCount,
              write.colorSlotGapFill,
            ),
          );
        }
      }
    },
  );

  return {
    timeline: nextTimeline,
    playbackWindowByOriginId: colorProgram.playbackWindowByOriginId,
  };
};

const materializePendingFrameApplication = (
  timeline: GeometryTimeline,
  application: PendingFrameApplication,
): PendingFrameApplicationMaterialization => {
  const sourceTimeline = application.precedingTemporalCheckpoint
    ? materializeTemporalCheckpointTimeline(
        timeline,
        application.precedingTemporalCheckpoint,
      )
    : timeline;

  if (application.kind === 'geometry-rewrite') {
    return {
      timeline: materializePendingGeometryRewriteApplication(sourceTimeline, application),
    };
  }

  if (application.kind === 'stroke-rewrite') {
    return {
      timeline: materializePendingStrokeRewriteApplication(sourceTimeline, application),
    };
  }

  return materializePendingColorApplication(sourceTimeline, application);
};

export const materializePendingFrameApplications = (
  state: MutableGenerationState,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  if (state.pendingFrameApplications.length === 0) {
    return state;
  }

  let timeline = state.timeline;
  const playbackWindowOverrideMaps: ReadonlyMap<string, TimelineWindow>[] = [];
  for (const application of state.pendingFrameApplications) {
    const materialization = materializePendingFrameApplication(timeline, application);
    timeline = materialization.timeline;
    if (materialization.playbackWindowByOriginId) {
      playbackWindowOverrideMaps.push(materialization.playbackWindowByOriginId);
    }
  }

  return transitionGenerationState(state, {
    timeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      timeline,
      state.timelineStateByOriginId,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
      undefined,
      mergePlaybackWindowOverrides(playbackWindowOverrideMaps),
    ),
    pendingFrameApplications: [],
  });
};
