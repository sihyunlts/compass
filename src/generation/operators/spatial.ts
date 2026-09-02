import {
  buildTargetOriginIds,
  createPendingGeometryApplicationOperator,
  appendPendingGeometryRewriteApplication,
  buildModulationEvaluationWindowByOriginId,
  isDeviceModulated,
  resolveModulatedDeviceAtFrame,
  transformStroke,
  type ModulationEvaluationWindow,
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
    evaluationWindow: ModulationEvaluationWindow,
  ) => GeneratorEffectNode,
  requiredFrameWindow: BeatRange | 'all',
  fallbackEvaluationWindow: ModulationEvaluationWindow,
): MutableGenerationState => {
  const { baseState } = input;
  const targetOriginIds = buildTargetOriginIds(baseState.timeline, targetGroupId);
  const evaluationWindowByTargetOriginId = buildModulationEvaluationWindowByOriginId(
    input,
    targetOriginIds,
    fallbackEvaluationWindow,
  );

  return appendPendingGeometryRewriteApplication(
    input,
    targetOriginIds,
    requiredFrameWindow,
    ({ timeline, frameIndex, strokes }) => {
      return strokes.map((stroke) => {
        const deviceAtFrame = isModulated
          ? resolveDeviceAtFrame(
              frameIndex,
              timeline.sampleStepBeats,
              evaluationWindowByTargetOriginId.get(stroke.polyline.originId)!,
            )
          : effect;
        return transformStroke(
          stroke,
          resolveEffectTransform(deviceAtFrame),
          writeOrder,
        );
      });
    },
  );
};

export const spatialTransformOperator = createPendingGeometryApplicationOperator<SpatialTransformStageKind>(
  (input, stage, context) => {
    const device = stage.device;
    const isModulated = isDeviceModulated(context.modulationContext, stage.deviceId);

    return applyPendingSpatialTransform(
      input,
      device,
      stage.groupId,
      stage.stageIndex,
      isModulated,
      (frameIndex, sampleStepBeats, evaluationWindow) => resolveModulatedDeviceAtFrame(
        context.modulationContext,
        device,
        frameIndex,
        sampleStepBeats,
        evaluationWindow,
      ) as GeneratorEffectNode,
      'all',
      {
        start: 0,
        end: context.modulationContext.loopLengthBeats,
      },
    );
  },
);
