import {
  buildTargetOriginIds,
  buildPendingStrokeRewriteFrameWrites,
  cloneMask,
  cloneStrokeWithWriteOrder,
  createPendingFrameApplicationOperator,
  appendPendingStrokeRewriteApplication,
  resolveFrameWindow,
  resolveStageExecutionPlan,
  transformStroke,
  type PendingFrameApplicationOperatorInput,
} from './runtime';
import {
  composeAffine,
  COMPOSITION_CENTER,
  toAxisMirrorTransformAt,
  toRotateTransformAt,
  toTranslationTransform,
} from '../../core/geometry';
import type { SymmetryEffectNode } from '../../shared/model';
import {
  type MutableGenerationState,
} from '../timeline/state';
import {
  createIdentityMask,
} from '../timeline';
import type { BeatRange } from '../analysis/types';
import type { GeometryStroke } from '../types';

const isWithinHalfBoundary = (
  coordinate: number,
  boundary: number,
  keepMin: boolean,
): boolean => keepMin ? coordinate <= boundary : coordinate >= boundary;

const isInQuadrant = (
  x: number,
  y: number,
  anchor: SymmetryEffectNode['params']['sourceAnchor'],
): boolean => {
  const keepMinX = anchor === 'bl' || anchor === 'tl';
  const keepMinY = anchor === 'bl' || anchor === 'br';
  return isWithinHalfBoundary(x, COMPOSITION_CENTER.x, keepMinX)
    && isWithinHalfBoundary(y, COMPOSITION_CENTER.y, keepMinY);
};

const buildMirrorHalfStrokeRewrite = (
  effect: SymmetryEffectNode,
  writeOrder: number,
): (stroke: GeometryStroke) => ReadonlyArray<Omit<GeometryStroke, 'writeId'>> => {
  const keepMin = effect.params.axis === 'horizontal'
    ? effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'tl'
    : effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'br';
  const mirrorTransform = toAxisMirrorTransformAt(effect.params.axis, COMPOSITION_CENTER);
  const boundary = effect.params.axis === 'horizontal' ? COMPOSITION_CENTER.x : COMPOSITION_CENTER.y;

  return (stroke) => {
    const sourceHalfMask = createIdentityMask((x, y) => isWithinHalfBoundary(
      effect.params.axis === 'horizontal' ? x : y,
      boundary,
      keepMin,
    ));
    const mirroredHalfMask = createIdentityMask((x, y) => isWithinHalfBoundary(
      effect.params.axis === 'horizontal' ? x : y,
      boundary,
      !keepMin,
    ));
    const mirroredStroke = transformStroke(stroke, mirrorTransform, writeOrder);

    return [
      {
        ...cloneStrokeWithWriteOrder(stroke, writeOrder),
        masks: [...stroke.masks.map(cloneMask), sourceHalfMask],
      },
      {
        ...mirroredStroke,
        masks: [...mirroredStroke.masks, mirroredHalfMask],
      },
    ];
  };
};

const buildQuadMirrorStrokeRewrite = (
  effect: SymmetryEffectNode,
  writeOrder: number,
): (stroke: GeometryStroke) => ReadonlyArray<Omit<GeometryStroke, 'writeId'>> => {
  const quadrants: ReadonlyArray<SymmetryEffectNode['params']['sourceAnchor']> = ['bl', 'br', 'tr', 'tl'];
  const sourceKeepMinX = effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'tl';
  const sourceKeepMinY = effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'br';

  return (stroke) => quadrants.map((quadrant) => {
    const targetKeepMinX = quadrant === 'bl' || quadrant === 'tl';
    const targetKeepMinY = quadrant === 'bl' || quadrant === 'br';

    let transform = null as ReturnType<typeof toTranslationTransform> | null;
    if (sourceKeepMinX !== targetKeepMinX) {
      transform = toAxisMirrorTransformAt('horizontal', COMPOSITION_CENTER);
    }
    if (sourceKeepMinY !== targetKeepMinY) {
      const verticalTransform = toAxisMirrorTransformAt('vertical', COMPOSITION_CENTER);
      transform = transform
        ? composeAffine(verticalTransform, transform)
        : verticalTransform;
    }

    const quadrantMask = createIdentityMask((x, y) => isInQuadrant(x, y, quadrant));
    const transformedStroke = transformStroke(stroke, transform, writeOrder);
    return {
      ...transformedStroke,
      masks: [...transformedStroke.masks, quadrantMask],
    };
  });
};

const buildQuadPinwheelStrokeRewrite = (
  effect: SymmetryEffectNode,
  writeOrder: number,
): (stroke: GeometryStroke) => ReadonlyArray<Omit<GeometryStroke, 'writeId'>> => {
  const quadrants: ReadonlyArray<SymmetryEffectNode['params']['sourceAnchor']> = ['bl', 'br', 'tr', 'tl'];
  const sourceIndex = quadrants.findIndex((quadrant) => quadrant === effect.params.sourceAnchor);

  return (stroke) => quadrants.map((quadrant, targetIndex) => {
    const delta = (targetIndex - sourceIndex + quadrants.length) % quadrants.length;
    const angleDeg = delta * 90;
    const transform = angleDeg === 0 ? null : toRotateTransformAt(angleDeg, COMPOSITION_CENTER);
    const quadrantMask = createIdentityMask((x, y) => isInQuadrant(x, y, quadrant));
    const transformedStroke = transformStroke(stroke, transform, writeOrder);
    return {
      ...transformedStroke,
      masks: [...transformedStroke.masks, quadrantMask],
    };
  });
};

const buildSymmetryStrokeRewrite = (
  effect: SymmetryEffectNode,
  writeOrder: number,
): (stroke: GeometryStroke) => ReadonlyArray<Omit<GeometryStroke, 'writeId'>> => {
  if (effect.params.mode === 'mirror-half') {
    return buildMirrorHalfStrokeRewrite(effect, writeOrder);
  }

  if (effect.params.mode === 'quad-mirror') {
    return buildQuadMirrorStrokeRewrite(effect, writeOrder);
  }

  return buildQuadPinwheelStrokeRewrite(effect, writeOrder);
};

const applyPendingSymmetryEffect = (
  input: PendingFrameApplicationOperatorInput,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  const { sourceState } = input;
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    sourceState.timeline.sampleStepBeats,
    sourceState.timeline.frames.length,
  );
  const targetOriginIds = buildTargetOriginIds(sourceState.timeline, targetGroupId);
  const rewriteStroke = buildSymmetryStrokeRewrite(effect, writeOrder);
  const writes = buildPendingStrokeRewriteFrameWrites(
    sourceState.timeline,
    targetOriginIds,
    frameWindow,
    (_frameIndex, strokes) => strokes.flatMap((stroke) => rewriteStroke(stroke)),
  );

  return appendPendingStrokeRewriteApplication(
    input,
    targetOriginIds,
    writes,
    { mode: 'cleanup', originIds: targetOriginIds },
  );
};

export const symmetryOperator = createPendingFrameApplicationOperator<'symmetry'>(
  (input, stage, context) => {
    const executionPlan = resolveStageExecutionPlan(context, stage);

    return applyPendingSymmetryEffect(
      input,
      stage.device,
      stage.groupId,
      stage.stageIndex,
      executionPlan.requiredFrameWindow,
    );
  },
);
