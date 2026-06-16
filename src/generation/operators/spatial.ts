import {
  buildTargetOriginIds,
  buildPendingStrokeRewriteFrameWrites,
  createRackOperator,
  appendPendingStrokeRewriteApplication,
  isDeviceModulated,
  preparePendingFrameApplicationInput,
  preservePendingRackOperatorInput,
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
  cloneSealedOriginIdsWithout,
  type PendingFrameApplication,
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
  state: MutableGenerationState,
  sourceState: MutableGenerationState,
  targetGroupId: string | null,
  writeOrder: number,
  resolveTransformAtFrame: (frameIndex: number) => ReturnType<typeof toTranslationTransform> | null,
  requiredFrameWindow: BeatRange | 'all',
  precedingTemporalCheckpoint: PendingFrameApplication['precedingTemporalCheckpoint'],
): MutableGenerationState => {
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
    state,
    sourceState,
    targetOriginIds,
    writes,
    precedingTemporalCheckpoint,
    cloneSealedOriginIdsWithout(state.sealedOriginIds, targetOriginIds),
  );
};

export const spatialTransformOperator = createRackOperator<SpatialTransformStageKind>(
  preservePendingRackOperatorInput,
  (state, stage, context) => {
    const device = stage.device;
    const executionPlan = resolveStageExecutionPlan(context, stage);
    const isModulated = isDeviceModulated(context.modulationContext, stage.deviceId);
    const {
      baseState,
      sourceState,
      precedingTemporalCheckpoint,
    } = preparePendingFrameApplicationInput(state, context);

    return applyPendingSpatialTransform(
      baseState,
      sourceState,
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
      precedingTemporalCheckpoint,
    );
  },
);
