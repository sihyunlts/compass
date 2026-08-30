import {
  buildTargetOriginIds,
  createPendingGeometryApplicationOperator,
  appendPendingGeometryRewriteApplication,
  isDeviceModulated,
  resolveModulatedDeviceAtFrame,
  transformStroke,
  type ModulationEvaluationWindow,
  type PendingGeometryApplicationOperatorInput,
} from './runtime';
import {
  buildSymmetryTransformPlan,
  isPointInSymmetrySector,
} from '../../core/symmetry';
import type { SymmetryEffectNode } from '../../shared/model';
import type { MutableGenerationState } from '../timeline/state';
import { createIdentityMask } from '../timeline';
import type { BeatRange } from '../analysis/types';
import type { GeometryStroke } from '../types';

const buildSymmetryStrokeRewrite = (
  effect: SymmetryEffectNode,
  writeOrder: number,
): (stroke: GeometryStroke) => ReadonlyArray<Omit<GeometryStroke, 'writeId'>> => {
  const center = {
    x: effect.params.centerX,
    y: effect.params.centerY,
  };
  const plan = buildSymmetryTransformPlan({
    mode: effect.params.mode,
    sourceScope: effect.params.sourceScope,
    count: effect.params.count,
    directionDeg: effect.params.directionDeg,
    center,
  });
  const targetSectorMasks = effect.params.sourceScope === 'sector'
    ? plan.steps.map((step) => createIdentityMask((x, y) => isPointInSymmetrySector(
        x,
        y,
        center,
        step.targetAngleDeg,
        plan.sectorWidthDeg,
      )))
    : null;

  return (stroke) => plan.steps.map((step, index) => {
    const transformedStroke = transformStroke(stroke, step.transform, writeOrder);
    const targetSectorMask = targetSectorMasks?.[index];
    if (!targetSectorMask) {
      return transformedStroke;
    }

    return {
      ...transformedStroke,
      masks: [...transformedStroke.masks, targetSectorMask],
    };
  });
};

const applyPendingSymmetryEffect = (
  input: PendingGeometryApplicationOperatorInput,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  isModulated: boolean,
  resolveDeviceAtFrame: (
    frameIndex: number,
    sampleStepBeats: number,
    evaluationWindow: ModulationEvaluationWindow,
  ) => SymmetryEffectNode,
  requiredFrameWindow: BeatRange | 'all',
  fallbackEvaluationWindow: ModulationEvaluationWindow,
): MutableGenerationState => {
  const { baseState } = input;
  const targetOriginIds = buildTargetOriginIds(baseState.timeline, targetGroupId);
  const evaluationWindowByTargetOriginId = new Map(
    Array.from(targetOriginIds, (originId) => {
      const timelineState = baseState.timelineStateByOriginId.get(originId);
      const window = input.precedingTemporalCheckpoint?.temporalByOriginId.has(originId)
        ? timelineState?.temporal.visibilityWindow
        : timelineState?.playbackWindow;
      return [
        originId,
        window && Number.isFinite(window.start) && Number.isFinite(window.end) && window.end > window.start
          ? window
          : fallbackEvaluationWindow,
      ] as const;
    }),
  );
  const rewriteByEffect = new WeakMap<
    SymmetryEffectNode,
    ReturnType<typeof buildSymmetryStrokeRewrite>
  >();
  const resolveStrokeRewrite = (
    effectAtFrame: SymmetryEffectNode,
  ): ReturnType<typeof buildSymmetryStrokeRewrite> => {
    const cached = rewriteByEffect.get(effectAtFrame);
    if (cached) {
      return cached;
    }

    const rewrite = buildSymmetryStrokeRewrite(effectAtFrame, writeOrder);
    rewriteByEffect.set(effectAtFrame, rewrite);
    return rewrite;
  };

  return appendPendingGeometryRewriteApplication(
    input,
    targetOriginIds,
    requiredFrameWindow,
    ({ timeline, frameIndex, strokes }) => strokes.flatMap((stroke) => {
      const evaluationWindow = evaluationWindowByTargetOriginId.get(
        stroke.polyline.originId,
      ) ?? fallbackEvaluationWindow;
      const effectAtFrame = isModulated
        ? resolveDeviceAtFrame(frameIndex, timeline.sampleStepBeats, evaluationWindow)
        : effect;
      return resolveStrokeRewrite(effectAtFrame)(stroke);
    }),
    { mode: 'cleanup', originIds: targetOriginIds },
  );
};

export const symmetryOperator = createPendingGeometryApplicationOperator<'symmetry'>(
  (input, stage, context) => {
    const isModulated = isDeviceModulated(context.modulationContext, stage.deviceId);

    return applyPendingSymmetryEffect(
      input,
      stage.device,
      stage.groupId,
      stage.stageIndex,
      isModulated,
      (frameIndex, sampleStepBeats, evaluationWindow) => resolveModulatedDeviceAtFrame(
        context.modulationContext,
        stage.device,
        frameIndex,
        sampleStepBeats,
        evaluationWindow,
      ),
      'all',
      {
        start: 0,
        end: context.modulationContext.loopLengthBeats,
      },
    );
  },
);
