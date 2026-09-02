import type { RepeatEffectNode } from '../../shared/model';
import {
  appendPendingStrokeRewriteApplication,
  buildTargetOriginIds,
  cloneStrokeWithWriteOrder,
  createPendingFrameApplicationOperator,
  type PendingFrameApplicationOperatorInput,
} from './runtime';
import { buildSourceStrokesByOriginAndFrame } from './runtime/timeline-strokes';
import { toFrameWindow } from '../timeline';
import { DEFAULT_TIMELINE_WINDOW } from '../timeline/temporal-window';
import type {
  MutableGenerationState,
  OriginTimelineState,
  PendingStrokeRewriteFrameWrite,
} from '../timeline/state';
import type { GeometryTimeline } from '../types';
import {
  buildFixedTimelineStateOverrides,
  resolveCanonicalSourceWindow,
} from './runtime/timeline-state';

const buildRepeatedFrameWrites = (
  timeline: GeometryTimeline,
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  targetOriginIds: ReadonlySet<string>,
  repeatCount: number,
  intervalPercent: number,
  writeOrder: number,
): PendingStrokeRewriteFrameWrite[] => {
  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    timeline,
    targetOriginIds,
  );
  const strokesByDestinationFrame = new Map<
    number,
    PendingStrokeRewriteFrameWrite['strokes'][number][]
  >();
  const intervalRatio = intervalPercent / 100;
  const repeatDurationRatio = 1 / (1 + (repeatCount - 1) * intervalRatio);
  const repeatStartStepRatio = repeatDurationRatio * intervalRatio;

  for (const originId of targetOriginIds) {
    const timelineState = timelineStateByOriginId.get(originId);
    if (!timelineState) {
      continue;
    }
    const sourceWindow = resolveCanonicalSourceWindow(timelineState);

    const sourceFrameWindow = toFrameWindow(
      sourceWindow,
      timeline.sampleStepBeats,
      timeline.frames.length,
    );
    const placementFrameWindow = toFrameWindow(
      DEFAULT_TIMELINE_WINDOW,
      timeline.sampleStepBeats,
      timeline.frames.length,
    );
    const sourceFrameCount = sourceFrameWindow.endFrameExclusive
      - sourceFrameWindow.startFrame;
    const placementFrameCount = placementFrameWindow.endFrameExclusive
      - placementFrameWindow.startFrame;
    if (sourceFrameCount <= 0 || placementFrameCount <= 0) {
      continue;
    }

    const sourceStrokesByFrame = sourceStrokesByOriginAndFrame.get(originId);
    if (!sourceStrokesByFrame) {
      continue;
    }

    for (
      let destinationFrameIndex = placementFrameWindow.startFrame;
      destinationFrameIndex < placementFrameWindow.endFrameExclusive;
      destinationFrameIndex += 1
    ) {
      const placementFrameOffset = destinationFrameIndex - placementFrameWindow.startFrame;
      const placementProgress = placementFrameOffset / placementFrameCount;
      const destinationStrokes = strokesByDestinationFrame.get(destinationFrameIndex) ?? [];

      for (let repeatIndex = 0; repeatIndex < repeatCount; repeatIndex += 1) {
        const repeatStart = repeatIndex * repeatStartStepRatio;
        const localProgress = (placementProgress - repeatStart) / repeatDurationRatio;
        if (localProgress < -1e-9 || localProgress >= 1 - 1e-9) {
          continue;
        }

        const sourceFrameOffset = Math.min(
          Math.floor(Math.max(localProgress, 0) * sourceFrameCount),
          sourceFrameCount - 1,
        );
        const sourceFrameIndex = sourceFrameWindow.startFrame + sourceFrameOffset;
        const sourceStrokes = sourceStrokesByFrame.get(sourceFrameIndex);
        if (!sourceStrokes || sourceStrokes.length === 0) {
          continue;
        }

        destinationStrokes.push(
          ...sourceStrokes.map((stroke) => cloneStrokeWithWriteOrder(stroke, writeOrder)),
        );
      }

      if (destinationStrokes.length > 0) {
        strokesByDestinationFrame.set(destinationFrameIndex, destinationStrokes);
      }
    }
  }

  return Array.from(strokesByDestinationFrame.entries())
    .sort(([leftFrameIndex], [rightFrameIndex]) => leftFrameIndex - rightFrameIndex)
    .map(([destinationFrameIndex, strokes]) => ({
      destinationFrameIndex,
      strokes,
    }));
};

const applyRepeatEffect = (
  input: PendingFrameApplicationOperatorInput,
  effect: RepeatEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
): MutableGenerationState => {
  const sourceState = input.sourceState;
  const { count: repeatCount, intervalPercent } = effect.params;
  const targetOriginIds = buildTargetOriginIds(sourceState.timeline, targetGroupId);
  if (repeatCount === 1 || targetOriginIds.size === 0) {
    return sourceState;
  }

  return appendPendingStrokeRewriteApplication(
    input,
    targetOriginIds,
    buildRepeatedFrameWrites(
      sourceState.timeline,
      sourceState.timelineStateByOriginId,
      targetOriginIds,
      repeatCount,
      intervalPercent,
      writeOrder,
    ),
    buildFixedTimelineStateOverrides(targetOriginIds),
  );
};

export const repeatOperator = createPendingFrameApplicationOperator<'repeat'>(
  (input, stage) => applyRepeatEffect(
    input,
    stage.device,
    stage.groupId,
    stage.stageIndex,
  ),
  'publish-timeline-state',
);
