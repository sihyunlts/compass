import { DEFAULT_TIMELINE_WINDOW } from '../timeline/temporal-window';
import {
  buildTargetOriginIds,
  createRackOperator,
  appendPendingGeometryRewriteApplication,
  buildModulationEvaluationWindowByOriginId,
  isDeviceModulated,
  resolveModulatedDeviceAtFrame,
  createStrokeTransformer,
  type ModulationEvaluationWindow,
} from './runtime';
import {
  buildSymmetryTransformPlan,
  isPointInSymmetrySector,
} from '../../core/symmetry';
import type { SymmetryEffectNode } from '../../shared/model';
import type { GenerationState } from '../timeline/state';
import { createIdentityMask } from '../timeline';
import type { GeometryStroke } from '../types';
import { copyStrokePath } from './runtime/timeline-strokes';

const buildSymmetryStrokeRewrite = (
  effect: SymmetryEffectNode,
  writeOrder: number,
): (stroke: GeometryStroke) => ReadonlyArray<Omit<GeometryStroke, 'writeId'>> => {
  const transformStroke = createStrokeTransformer();
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
    const transformedStroke = copyStrokePath(
      transformStroke(stroke, step.transform, writeOrder), index,
    );
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
  state: GenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  isModulated: boolean,
  resolveDeviceAtFrame: (
    frameIndex: number,
    sampleStepBeats: number,
    evaluationWindow: ModulationEvaluationWindow,
  ) => SymmetryEffectNode,
  fallbackEvaluationWindow: ModulationEvaluationWindow,
): GenerationState => {
  const targetOriginIds = buildTargetOriginIds(state.timeline, targetGroupId);
  const evaluationWindowByTargetOriginId = buildModulationEvaluationWindowByOriginId(
    state,
    targetOriginIds,
    fallbackEvaluationWindow,
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
    state,
    targetOriginIds,
    ({ sampleStepBeats, frameIndex, strokes }) => strokes.flatMap((stroke) => {
      const evaluationWindow = evaluationWindowByTargetOriginId.get(
        stroke.polyline.originId,
      ) ?? fallbackEvaluationWindow;
      const effectAtFrame = isModulated
        ? resolveDeviceAtFrame(frameIndex, sampleStepBeats, evaluationWindow)
        : effect;
      return resolveStrokeRewrite(effectAtFrame)(stroke);
    }),
  );
};

export const symmetryOperator = createRackOperator<'symmetry', 'preserve-pending'>(
  'preserve-pending',
  (state, stage, context) => {
    const isModulated = isDeviceModulated(context.modulationContext, stage.deviceId);

    return applyPendingSymmetryEffect(
      state,
      stage.device,
      stage.targetGroupId,
      stage.stageIndex,
      isModulated,
      (frameIndex, sampleStepBeats, evaluationWindow) => resolveModulatedDeviceAtFrame(
        context.modulationContext,
        stage.device,
        frameIndex,
        sampleStepBeats,
        evaluationWindow,
      ),
      DEFAULT_TIMELINE_WINDOW,
    );
  },
);
