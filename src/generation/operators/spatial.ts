import {
  buildTimelineStateByOriginId,
  createRackOperator,
  forEachTargetedFrame,
  materializeRackOperatorInput,
  resolveModulatedDeviceAtFrame,
  resolveFrameWindow,
  resolveStageExecutionPlan,
  transformStroke,
  type SpatialTransformStageKind,
} from './runtime';
import {
  COMPOSITION_CENTER,
  toMirrorTransformAt,
  toRotateTransformAt,
  toScaleTransformAt,
  toTranslationTransform,
} from '../../core/geometry';
import type { GeneratorEffectNode } from '../../shared/model';
import {
  clonePendingTemporalWriteOrderByOriginId,
  cloneSealedOriginIds,
  type MutableGenerationState,
} from '../timeline/state';
import {
  addStrokeToFrame,
  beginTimelineStage,
  completeTimelineStage,
} from '../timeline';
import type { BeatRange } from '../analysis/types';
import type { CanonicalOutputAdapter } from '../types';

const resolveEffectTransform = (
  effect: GeneratorEffectNode,
): ReturnType<typeof toTranslationTransform> | null => {
  if (effect.kind === 'mirror') {
    return toMirrorTransformAt(effect.params.angleDeg, COMPOSITION_CENTER);
  }

  if (effect.kind === 'rotate') {
    return toRotateTransformAt(effect.params.angleDeg, COMPOSITION_CENTER);
  }

  if (effect.kind === 'translate') {
    return toTranslationTransform(effect.params.offsetX, effect.params.offsetY);
  }

  if (effect.kind === 'scale') {
    return toScaleTransformAt(
      effect.params.scaleX,
      effect.params.scaleY,
      {
        x: effect.params.centerX,
        y: effect.params.centerY,
      },
    );
  }

  return null;
};

const applySpatialTransform = (
  state: MutableGenerationState,
  targetGroupId: string | null,
  writeOrder: number,
  resolveTransformAtFrame: (frameIndex: number) => ReturnType<typeof toTranslationTransform> | null,
  requiredFrameWindow: BeatRange | 'all',
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const nextTimeline = beginTimelineStage(state.timeline);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    state.timeline.frames.length,
  );

  forEachTargetedFrame(nextTimeline, state.timeline.frames.length, targetGroupId, frameWindow, (frameIndex, targeted) => {
    const transform = resolveTransformAtFrame(frameIndex);
    for (const stroke of targeted) {
      addStrokeToFrame(nextTimeline, frameIndex, transformStroke(stroke, transform, writeOrder));
    }
  });

  const sealedTimeline = completeTimelineStage(nextTimeline);
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
    sealedOriginIds: cloneSealedOriginIds(state.sealedOriginIds),
  };
};

export const spatialTransformOperator = createRackOperator<SpatialTransformStageKind>(
  materializeRackOperatorInput,
  (state, stage, context) => {
    const device = stage.device;
    const executionPlan = resolveStageExecutionPlan(context, stage);

    return applySpatialTransform(
      state,
      stage.groupId,
      stage.stageIndex,
      (frameIndex) => resolveEffectTransform(
        resolveModulatedDeviceAtFrame(
          context.modulationContext,
          device,
          frameIndex,
          state.timeline.sampleStepBeats,
          state.timeline.timeDomainEndBeat,
        ),
      ),
      executionPlan.requiredFrameWindow,
      context.outputAdapter,
      context.mutedGroupIds,
      context.mutedGeneratorIds,
    );
  },
);
