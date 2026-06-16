import {
  buildColorConfig,
  planColorProgramSlots,
  type PlannedColorSlot,
  type TimedColorSource,
} from '../../devices/color/color-program';
import type { ColorEffectNode } from '../../shared/model';
import type { BeatRange } from '../analysis/types';
import {
  clonePendingTemporalWriteOrderByOriginId,
  clonePendingFrameApplications,
  cloneSealedOriginIdsWithout,
  cloneTimelineStateByOriginId,
  type PendingFrameApplication,
  type PendingColorFrameWrite,
  type MutableGenerationState,
  type PendingTemporalMaterializationCheckpoint,
} from '../timeline/state';
import {
  toFrameWindow,
  toFrameCount,
  type FrameWindow,
} from '../timeline';
import type { GeometryStroke } from '../types';
import {
  createRackOperator,
  isFrameWithinWindow,
  preparePendingFrameApplicationInput,
  preservePendingRackOperatorInput,
  resolveColorSlotDestinationFrameIndexes,
  resolveColorSlotWriteOrder,
  resolveFrameWindow,
  resolveStageExecutionPlan,
} from './runtime';
import { mergeTimelineWindows, type TimelineWindow } from '../timeline/temporal-window';
import { buildColorSourceSnapshot } from './runtime/pending-frame-applications';

const buildSourceFrameIndexesByOriginId = (
  sourceStrokesByOriginAndFrame: ReadonlyMap<string, ReadonlyMap<number, ReadonlyArray<GeometryStroke>>>,
): Map<string, number[]> => new Map(
  Array.from(sourceStrokesByOriginAndFrame.entries(), ([originId, frameMap]) => [
    originId,
    Array.from(frameMap.keys()).sort((left, right) => left - right),
  ]),
);

interface ColorTimingSegment extends TimedColorSource {
  originId: string;
}

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
  colorConfig: {
    velocities: ReadonlyArray<number>;
    noteLengthPercent: number;
    gapPercent: number;
  },
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

const applyPlaybackWindowOverrides = (
  state: MutableGenerationState,
  playbackWindowByOriginId: ReadonlyMap<string, TimelineWindow>,
): MutableGenerationState['timelineStateByOriginId'] => {
  if (playbackWindowByOriginId.size === 0) {
    return cloneTimelineStateByOriginId(state.timelineStateByOriginId);
  }

  const timelineStateByOriginId = cloneTimelineStateByOriginId(state.timelineStateByOriginId);
  for (const [originId, playbackWindow] of playbackWindowByOriginId.entries()) {
    const current = timelineStateByOriginId.get(originId);
    if (!current) {
      continue;
    }

    timelineStateByOriginId.set(originId, {
      ...current,
      playbackWindow: mergeTimelineWindows(current.playbackWindow, playbackWindow),
    });
  }

  return timelineStateByOriginId;
};

const applyColorEffect = (
  state: MutableGenerationState,
  sourceState: MutableGenerationState,
  effect: ColorEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null,
): MutableGenerationState => {
  const colorConfig = buildColorConfig(effect);
  const sourceSnapshot = buildColorSourceSnapshot(
    sourceState.timeline,
    targetGroupId,
    {
      excludeMutedSources: targetGroupId === null,
      mutedGroupIds,
      mutedGeneratorIds,
    },
  );
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    sourceState.timeline.sampleStepBeats,
    sourceSnapshot.frameCount,
  );
  const targetOriginIds = sourceSnapshot.targetOriginIds;
  const sourceStrokesByOriginAndFrame = sourceSnapshot.sourceStrokesByOriginAndFrame;
  const targetSegmentsByOriginId = buildSourceTimingSegmentsByOriginId(
    sourceStrokesByOriginAndFrame,
    sourceState.timeline.sampleStepBeats,
  );
  const sourceFrameIndexesByOriginId = buildSourceFrameIndexesByOriginId(
    sourceStrokesByOriginAndFrame,
  );
  const colorSlotsByOriginId = new Map<string, PlannedColorSlot<ColorTimingSegment>[]>();
  let colorTimelineEndBeat = sourceSnapshot.timeDomainEndBeat;

  for (const [originId, sourceSegments] of targetSegmentsByOriginId.entries()) {
    if (isStaticColorSource(sourceSegments, sourceState.timeline.sampleStepBeats)) {
      continue;
    }

    const slots = planColorProgramSlots(sourceSegments, colorConfig);
    colorSlotsByOriginId.set(originId, slots);
    if (hasExtendedColorSlots(sourceSegments, colorConfig)) {
      colorTimelineEndBeat = resolveColorPlaybackEndBeat(slots, colorTimelineEndBeat);
    }
  }

  const colorFrameCount = toFrameCount(colorTimelineEndBeat, sourceState.timeline.sampleStepBeats);
  const writes: PendingColorFrameWrite[] = [];
  const playbackWindowByOriginId = new Map<string, TimelineWindow>();

  for (const [originId, sourceSegments] of targetSegmentsByOriginId.entries()) {
    const sourceStrokesByFrame = sourceStrokesByOriginAndFrame.get(originId);
    const sourceFrameIndexes = sourceFrameIndexesByOriginId.get(originId);
    if (!sourceStrokesByFrame || !sourceFrameIndexes || sourceFrameIndexes.length === 0) {
      continue;
    }

    if (isStaticColorSource(sourceSegments, sourceState.timeline.sampleStepBeats)) {
      const staticSourceSegment = sourceSegments[0];
      for (const sourceFrameIndex of sourceFrameIndexes) {
        if (!isFrameWithinWindow(sourceFrameIndex, frameWindow)) {
          continue;
        }

        const staticSlot = resolveStaticColorSlotAtFrame(
          staticSourceSegment,
          sourceFrameIndex,
          sourceState.timeline.sampleStepBeats,
          colorConfig,
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
            writeOrder: resolveColorSlotWriteOrder(writeOrder, staticSlot.slotIndex, staticSlot.slotCount),
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
    const hasExtendedSlots = hasExtendedColorSlots(sourceSegments, colorConfig);
    const colorFrameWindow = hasExtendedSlots
      ? resolveFrameWindow('all', sourceState.timeline.sampleStepBeats, colorFrameCount)
      : frameWindow;
    if (hasExtendedSlots) {
      const playbackWindow = resolveColorPlaybackWindow(slots);
      if (playbackWindow) {
        playbackWindowByOriginId.set(originId, playbackWindow);
      }
    }

    const shouldWrapColorSlots = colorConfig.gapPercent <= 0
      && isMovingColorSource;
    for (const slot of slots) {
      const sourceFrameWindow = resolveColorSlotSourceFrameWindow(
        slot,
        sourceState.timeline.sampleStepBeats,
        sourceSnapshot.frameCount,
      );
      const destinationFrameWindow = resolveColorSlotDestinationFrameWindow(
        slot,
        sourceState.timeline.sampleStepBeats,
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
          sourceState.timeline.sampleStepBeats,
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
          writeOrder: resolveColorSlotWriteOrder(writeOrder, slot.slotIndex, colorConfig.velocities.length),
          slotIndex: slot.slotIndex,
          slotCount: colorConfig.velocities.length,
          colorSlotGapFill: slot.source.referenceDuration !== undefined && colorConfig.gapPercent <= 0,
        });
      }
    }
  }

  const pendingFrameApplication: PendingFrameApplication = {
    kind: 'color',
    precedingTemporalCheckpoint,
    targetOriginIds,
    sourceFrameCount: sourceSnapshot.frameCount,
    endBeat: colorTimelineEndBeat,
    playbackWindowByOriginId,
    writes,
  };
  const pendingFrameApplications = clonePendingFrameApplications(state.pendingFrameApplications);
  if (targetOriginIds.size > 0) {
    pendingFrameApplications.push(pendingFrameApplication);
  }

  return {
    timeline: state.timeline,
    timelineStateByOriginId: applyPlaybackWindowOverrides(state, playbackWindowByOriginId),
    pendingTemporalWriteOrderByOriginId: clonePendingTemporalWriteOrderByOriginId(
      state.pendingTemporalWriteOrderByOriginId,
    ),
    pendingFrameApplications,
    sealedOriginIds: cloneSealedOriginIdsWithout(state.sealedOriginIds, targetOriginIds),
  };
};


export const colorOperator = createRackOperator<'color'>(
  preservePendingRackOperatorInput,
  (state, stage, context) => {
    const device = stage.device;
    const executionPlan = resolveStageExecutionPlan(context, stage);
    const {
      baseState,
      sourceState,
      precedingTemporalCheckpoint,
    } = preparePendingFrameApplicationInput(state, context);

    return applyColorEffect(
      baseState,
      sourceState,
      device,
      stage.groupId,
      stage.stageIndex,
      executionPlan.requiredFrameWindow,
      context.mutedGroupIds,
      context.mutedGeneratorIds,
      precedingTemporalCheckpoint,
    );
  },
);
