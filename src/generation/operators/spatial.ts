import {
  buildTargetOriginIds,
  buildPendingStrokeRewriteFrameWrites,
  createPendingFrameApplicationOperator,
  appendPendingStrokeRewriteApplication,
  isDeviceModulated,
  resolveModulatedDeviceAtFrame,
  resolveFrameWindow,
  resolveStageExecutionPlan,
  transformStroke,
  type PendingFrameApplicationOperatorInput,
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
  type MutableGenerationState,
} from '../timeline/state';
import type { BeatRange } from '../analysis/types';

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

const applyPendingSpatialTransform = (
  input: PendingFrameApplicationOperatorInput,
  targetGroupId: string | null,
  writeOrder: number,
  resolveTransformAtFrame: (frameIndex: number) => ReturnType<typeof toTranslationTransform> | null,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  const { sourceState } = input;
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    sourceState.timeline.sampleStepBeats,
    sourceState.timeline.frames.length,
  );
  const targetOriginIds = buildTargetOriginIds(sourceState.timeline, targetGroupId);
  const writes = buildPendingStrokeRewriteFrameWrites(
    sourceState.timeline,
    targetOriginIds,
    frameWindow,
    (frameIndex, strokes) => {
      const transform = resolveTransformAtFrame(frameIndex);
      return strokes.map((stroke) => transformStroke(stroke, transform, writeOrder));
    },
  );

  return appendPendingStrokeRewriteApplication(
    input,
    targetOriginIds,
    writes,
    { mode: 'cleanup', originIds: targetOriginIds },
  );
};

export const spatialTransformOperator = createPendingFrameApplicationOperator<SpatialTransformStageKind>(
  (input, stage, context) => {
    const { sourceState } = input;
    const device = stage.device;
    const executionPlan = resolveStageExecutionPlan(context, stage);
    const isModulated = isDeviceModulated(context.modulationContext, stage.deviceId);

    return applyPendingSpatialTransform(
      input,
      stage.groupId,
      stage.stageIndex,
      (frameIndex) => resolveEffectTransform(
        isModulated
          ? resolveModulatedDeviceAtFrame(
              context.modulationContext,
              device,
              frameIndex,
              sourceState.timeline.sampleStepBeats,
              sourceState.timeline.timeDomainEndBeat,
            )
          : device,
      ),
      executionPlan.requiredFrameWindow,
    );
  },
);
