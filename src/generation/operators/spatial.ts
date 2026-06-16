import {
  buildTargetOriginIds,
  createPendingGeometryApplicationOperator,
  appendPendingGeometryRewriteApplication,
  isDeviceModulated,
  resolveModulatedDeviceAtFrame,
  resolveStageExecutionPlan,
  transformStroke,
  type PendingGeometryApplicationOperatorInput,
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
  input: PendingGeometryApplicationOperatorInput,
  effect: GeneratorEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  isModulated: boolean,
  resolveDeviceAtFrame: (
    frameIndex: number,
    sampleStepBeats: number,
    timeDomainEndBeat: number,
  ) => GeneratorEffectNode,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  const { baseState } = input;
  const targetOriginIds = buildTargetOriginIds(baseState.timeline, targetGroupId);

  return appendPendingGeometryRewriteApplication(
    input,
    targetOriginIds,
    requiredFrameWindow,
    ({ timeline, frameIndex, strokes }) => {
      const deviceAtFrame = isModulated
        ? resolveDeviceAtFrame(
            frameIndex,
            timeline.sampleStepBeats,
            timeline.timeDomainEndBeat,
          )
        : effect;
      const transform = resolveEffectTransform(deviceAtFrame);
      return strokes.map((stroke) => transformStroke(stroke, transform, writeOrder));
    },
    { mode: 'cleanup', originIds: targetOriginIds },
  );
};

export const spatialTransformOperator = createPendingGeometryApplicationOperator<SpatialTransformStageKind>(
  (input, stage, context) => {
    const device = stage.device;
    const executionPlan = resolveStageExecutionPlan(context, stage);
    const isModulated = isDeviceModulated(context.modulationContext, stage.deviceId);

    return applyPendingSpatialTransform(
      input,
      device,
      stage.groupId,
      stage.stageIndex,
      isModulated,
      (frameIndex, sampleStepBeats, timeDomainEndBeat) => resolveModulatedDeviceAtFrame(
        context.modulationContext,
        device,
        frameIndex,
        sampleStepBeats,
        timeDomainEndBeat,
      ) as GeneratorEffectNode,
      executionPlan.requiredFrameWindow,
    );
  },
);
