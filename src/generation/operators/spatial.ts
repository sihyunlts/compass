import {
  buildTargetOriginIds,
  createRackOperator,
  appendPendingGeometryRewriteApplication,
  buildModulationEvaluationWindowByOriginId,
  isDeviceModulated,
  resolveModulatedDeviceAtFrame,
  createStrokeTransformer,
  type ModulationEvaluationWindow,
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
  type GenerationState,
} from '../timeline/state';

type SpatialTransformEffectNode = Extract<GeneratorEffectNode, { kind: SpatialTransformStageKind }>;

const resolveEffectTransform = (
  effect: SpatialTransformEffectNode,
): ReturnType<typeof toTranslationTransform> => {
  if (effect.kind === 'mirror') {
    return toMirrorTransformAt(effect.params.angleDeg, COMPOSITION_CENTER);
  }

  if (effect.kind === 'rotate') {
    return toRotateTransformAt(effect.params.angleDeg, {
      x: effect.params.centerX,
      y: effect.params.centerY,
    });
  }

  if (effect.kind === 'translate') {
    return toTranslationTransform(effect.params.offsetX, effect.params.offsetY);
  }

  return toScaleTransformAt(
    effect.params.scaleX,
    effect.params.scaleY,
    {
      x: effect.params.centerX,
      y: effect.params.centerY,
    },
  );
};

const applyPendingSpatialTransform = (
  state: GenerationState,
  effect: SpatialTransformEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  isModulated: boolean,
  resolveDeviceAtFrame: (
    frameIndex: number,
    sampleStepBeats: number,
    evaluationWindow: ModulationEvaluationWindow,
  ) => SpatialTransformEffectNode,
  fallbackEvaluationWindow: ModulationEvaluationWindow,
): GenerationState => {
  const targetOriginIds = buildTargetOriginIds(state.timeline, targetGroupId);
  const evaluationWindowByTargetOriginId = buildModulationEvaluationWindowByOriginId(
    state,
    targetOriginIds,
    fallbackEvaluationWindow,
  );

  return appendPendingGeometryRewriteApplication(
    state,
    targetOriginIds,
    ({ sampleStepBeats, frameIndex, strokes }) => {
      const transformStroke = createStrokeTransformer();
      return strokes.map((stroke) => {
        const deviceAtFrame = isModulated
          ? resolveDeviceAtFrame(
              frameIndex,
              sampleStepBeats,
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

export const spatialTransformOperator = createRackOperator<SpatialTransformStageKind, 'preserve-pending'>(
  'preserve-pending',
  (state, stage, context) => {
    const device = stage.device;
    const isModulated = isDeviceModulated(context.modulationContext, stage.deviceId);

    return applyPendingSpatialTransform(
      state,
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
      ),
      {
        start: 0,
        end: context.modulationContext.loopLengthBeats,
      },
    );
  },
);
