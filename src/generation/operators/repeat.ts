import type { RepeatEffectNode } from '../../shared/model';
import {
  appendPendingStrokeRewriteApplication,
  buildTargetOriginIds,
  transformStroke,
  createRackOperator,
  materializeRackState,
} from './runtime';
import { buildSourceStrokesByOriginAndFrame, copyStrokePath } from './runtime/timeline-strokes';
import { toFrameWindow } from '../timeline';
import { DEFAULT_TIMELINE_WINDOW } from '../timeline/temporal-window';
import type {
  GenerationState,
  MaterializedGenerationState,
  OriginTimelineState,
  PendingStrokeRewriteWrite,
} from '../timeline/state';
import type { ColorLayer, GeometryStroke, GeometryTimeline } from '../types';
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
): PendingStrokeRewriteWrite[] => {
  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    timeline,
    targetOriginIds,
  );
  const strokesByDestinationFrame = new Map<
    number,
    PendingStrokeRewriteWrite['strokes'][number][]
  >();
  const intervalRatio = intervalPercent / 100;
  const repeatedLayers = new Map<ColorLayer, Map<number, ColorLayer>>();
  const repeatedStrokes = new Map<GeometryStroke, Map<number, Omit<GeometryStroke, 'writeId'>>>();
  const repeatStroke = (stroke: GeometryStroke, repeatIndex: number): Omit<GeometryStroke, 'writeId'> => {
    let copies = repeatedStrokes.get(stroke);
    if (!copies) {
      copies = new Map();
      repeatedStrokes.set(stroke, copies);
    }
    const cached = copies.get(repeatIndex);
    if (cached) return cached;

    let result = copyStrokePath(transformStroke(stroke, null, writeOrder), repeatIndex);
    const binding = stroke.colorBinding;
    if (binding) {
      let layers = repeatedLayers.get(binding.layer);
      if (!layers) {
        layers = new Map();
        repeatedLayers.set(binding.layer, layers);
      }
      let layer = layers.get(repeatIndex);
      if (!layer) {
        layer = { order: [...binding.layer.order, repeatIndex] };
        layers.set(repeatIndex, layer);
      }
      result = { ...result, colorBinding: { ...binding, layer } };
    }
    copies.set(repeatIndex, result);
    return result;
  };
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
      timeline.frameCount,
    );
    const placementFrameWindow = toFrameWindow(
      DEFAULT_TIMELINE_WINDOW,
      timeline.sampleStepBeats,
      timeline.frameCount,
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

        for (const stroke of sourceStrokes) {
          destinationStrokes.push(repeatStroke(stroke, repeatIndex));
        }
      }

      if (destinationStrokes.length > 0) {
        strokesByDestinationFrame.set(destinationFrameIndex, destinationStrokes);
      }
    }
  }

  return Array.from(strokesByDestinationFrame.entries())
    .sort(([leftFrameIndex], [rightFrameIndex]) => leftFrameIndex - rightFrameIndex)
    .map(([destinationFrameIndex, strokes]) => ({
      startFrame: destinationFrameIndex,
      endFrameExclusive: destinationFrameIndex + 1,
      strokes,
    }));
};

const applyRepeatEffect = (
  sourceState: MaterializedGenerationState,
  effect: RepeatEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
): GenerationState => {
  const { count: repeatCount, intervalPercent } = effect.params;
  const targetOriginIds = buildTargetOriginIds(sourceState.timeline, targetGroupId);
  if (repeatCount === 1 || targetOriginIds.size === 0) {
    return sourceState;
  }

  return appendPendingStrokeRewriteApplication(
    sourceState,
    sourceState.timeline,
    targetOriginIds,
    buildRepeatedFrameWrites(
      sourceState.timeline,
      sourceState.timelineStateByOriginId,
      targetOriginIds,
      repeatCount,
      intervalPercent,
      writeOrder,
    ),
    { timelineStateOverrides: buildFixedTimelineStateOverrides(targetOriginIds) },
  );
};

export const repeatOperator = createRackOperator<'repeat', 'materialize-all'>(
  'materialize-all',
  (state, stage, context) => materializeRackState(
    applyRepeatEffect(
      state,
      stage.device,
      stage.targetGroupId,
      stage.stageIndex,
    ),
    context,
  ),
);
