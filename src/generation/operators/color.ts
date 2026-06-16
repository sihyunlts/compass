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
  cloneSealedOriginIds,
  type MutableGenerationState,
} from '../timeline/state';
import {
  addStrokeToFrame,
  addStrokeToFrames,
  beginTimelineStage,
  completeTimelineStage,
  ensureTimelineFrameCount,
  toFrameWindow,
  type FrameWindow,
} from '../timeline';
import type { CanonicalOutputAdapter, GeometryStroke, GeometryTimeline } from '../types';
import {
  buildSourceStrokesByOriginAndFrame,
  buildTargetOriginIds,
  buildTimelineStateByOriginId,
  cloneStrokeWithVelocityAndWriteOrder,
  createRackOperator,
  isFrameWithinWindow,
  materializeRackOperatorInput,
  resolveColorSlotDestinationFrameIndexes,
  resolveColorSlotWriteOrder,
  resolveFrameWindow,
  resolveStageExecutionPlan,
  stripOriginFrames,
} from './runtime';

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
  timeline: GeometryTimeline,
): FrameWindow => {
  const startBeat = slot.sourceStartBeat;
  const endBeat = resolveColorSlotSourceEndBeat(slot);
  const startFrame = Math.min(
    Math.max(Math.round(startBeat / timeline.sampleStepBeats), 0),
    timeline.frames.length,
  );
  const endFrameExclusive = Math.min(
    Math.max(Math.ceil((endBeat / timeline.sampleStepBeats) - 1e-9), startFrame),
    timeline.frames.length,
  );

  return {
    startFrame,
    endFrameExclusive,
  };
};

const resolveColorSlotDestinationFrameWindow = <T extends TimedColorSource>(
  slot: PlannedColorSlot<T>,
  timeline: GeometryTimeline,
): FrameWindow => {
  if (slot.source.referenceDuration === undefined) {
    return toFrameWindow(
      {
        start: slot.startBeat,
        end: slot.endBeat,
      },
      timeline.sampleStepBeats,
      timeline.frames.length,
    );
  }

  const segmentDuration = slot.endBeat - slot.startBeat;
  const extraDuration = Math.max(segmentDuration - slot.source.referenceDuration, 0);
  return toFrameWindow(
    {
      start: slot.startBeat,
      end: slot.startBeat + timeline.sampleStepBeats + extraDuration,
    },
    timeline.sampleStepBeats,
    timeline.frames.length,
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


const applyColorEffect = (
  state: MutableGenerationState,
  effect: ColorEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const nextTimeline = beginTimelineStage(state.timeline);
  const colorConfig = buildColorConfig(effect);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    state.timeline.frames.length,
  );
  const targetOriginIds = buildTargetOriginIds(
    state.timeline,
    targetGroupId,
    {
      excludeMutedSources: targetGroupId === null,
      mutedGroupIds,
      mutedGeneratorIds,
    },
  );
  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    state.timeline,
    targetOriginIds,
  );
  const targetSegmentsByOriginId = buildSourceTimingSegmentsByOriginId(
    sourceStrokesByOriginAndFrame,
    state.timeline.sampleStepBeats,
  );
  const sourceFrameIndexesByOriginId = buildSourceFrameIndexesByOriginId(
    sourceStrokesByOriginAndFrame,
  );

  stripOriginFrames(nextTimeline, state.timeline.frames.length, targetOriginIds);

  for (const [originId, sourceSegments] of targetSegmentsByOriginId.entries()) {
    const sourceStrokesByFrame = sourceStrokesByOriginAndFrame.get(originId);
    const sourceFrameIndexes = sourceFrameIndexesByOriginId.get(originId);
    if (!sourceStrokesByFrame || !sourceFrameIndexes || sourceFrameIndexes.length === 0) {
      continue;
    }

    if (isStaticColorSource(sourceSegments, state.timeline.sampleStepBeats)) {
      const staticSourceSegment = sourceSegments[0];
      for (const sourceFrameIndex of sourceFrameIndexes) {
        if (!isFrameWithinWindow(sourceFrameIndex, frameWindow)) {
          continue;
        }

        const staticSlot = resolveStaticColorSlotAtFrame(
          staticSourceSegment,
          sourceFrameIndex,
          state.timeline.sampleStepBeats,
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
          addStrokeToFrame(
            nextTimeline,
            sourceFrameIndex,
            cloneStrokeWithVelocityAndWriteOrder(
              stroke,
              staticSlot.velocity,
              resolveColorSlotWriteOrder(writeOrder, staticSlot.slotIndex, staticSlot.slotCount),
              staticSlot.slotIndex,
              staticSlot.slotCount,
              false,
            ),
          );
        }
      }

      continue;
    }

    const slots = planColorProgramSlots(sourceSegments, colorConfig);
    if (slots.length === 0) {
      continue;
    }

    const hasActivationColorSlots = sourceSegments.some(
      (sourceSegment) => sourceSegment.referenceDuration !== undefined,
    );
    const isMovingColorSource = isNonSteppedMovingColorSource(sourceSegments);
    const hasExtendedColorSlots = hasActivationColorSlots
      || (colorConfig.gapPercent > 0 && isMovingColorSource);
    if (hasExtendedColorSlots) {
      const colorEndBeat = slots.reduce(
        (maxEndBeat, slot) => Math.max(maxEndBeat, slot.endBeat),
        nextTimeline.timeDomainEndBeat,
      );
      ensureTimelineFrameCount(nextTimeline, colorEndBeat);
    }
    const colorFrameWindow = hasExtendedColorSlots
      ? resolveFrameWindow('all', nextTimeline.sampleStepBeats, nextTimeline.frames.length)
      : frameWindow;
    const shouldWrapColorSlots = colorConfig.gapPercent <= 0
      && isMovingColorSource;
    for (const slot of slots) {
      const sourceFrameWindow = resolveColorSlotSourceFrameWindow(slot, state.timeline);
      const destinationFrameWindow = resolveColorSlotDestinationFrameWindow(slot, nextTimeline);

      for (const sourceFrameIndex of sourceFrameIndexes) {
        if (sourceFrameIndex < sourceFrameWindow.startFrame) {
          continue;
        }
        if (sourceFrameIndex >= sourceFrameWindow.endFrameExclusive) {
          break;
        }

        const destinationFrameIndex = resolveColorDestinationFrameIndex(
          slot.startBeat,
          nextTimeline.sampleStepBeats,
        );
        const destinationFrameIndexes = resolveColorSlotDestinationFrameIndexes(
          slot.source,
          destinationFrameIndex,
          destinationFrameWindow,
          nextTimeline.frames.length,
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

        for (const stroke of sourceStrokes) {
          addStrokeToFrames(
            nextTimeline,
            resolvedDestinationFrameIndexes,
            cloneStrokeWithVelocityAndWriteOrder(
              stroke,
              slot.velocity,
              resolveColorSlotWriteOrder(writeOrder, slot.slotIndex, colorConfig.velocities.length),
              slot.slotIndex,
              colorConfig.velocities.length,
              slot.source.referenceDuration !== undefined && colorConfig.gapPercent <= 0,
            ),
          );
        }
      }
    }
  }

  const sealedTimeline = completeTimelineStage(nextTimeline);
  const sealedOriginIds = cloneSealedOriginIds(state.sealedOriginIds);
  for (const originId of targetOriginIds) {
    sealedOriginIds.delete(originId);
  }
  return {
    timeline: sealedTimeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      sealedTimeline,
      state.timelineStateByOriginId,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    pendingTemporalWriteOrderByOriginId: clonePendingTemporalWriteOrderByOriginId(
      state.pendingTemporalWriteOrderByOriginId,
    ),
    sealedOriginIds,
  };
};


export const colorOperator = createRackOperator<'color'>(
  materializeRackOperatorInput,
  (state, stage, context) => {
    const device = stage.device;
    const executionPlan = resolveStageExecutionPlan(context, stage);

    return applyColorEffect(
      state,
      device,
      stage.groupId,
      stage.stageIndex,
      executionPlan.requiredFrameWindow,
      context.outputAdapter,
      context.mutedGroupIds,
      context.mutedGeneratorIds,
    );
  },
);
