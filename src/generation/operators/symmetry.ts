import {
  buildTimelineStateByOriginId,
  cloneMask,
  cloneStrokeWithWriteOrder,
  createRackOperator,
  forEachTargetedFrame,
  materializeRackOperatorInput,
  resolveFrameWindow,
  resolveStageExecutionPlan,
  transformStroke,
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
  clonePendingTemporalWriteOrderByOriginId,
  cloneSealedOriginIds,
  type MutableGenerationState,
} from '../timeline/state';
import {
  addStrokeToFrame,
  beginTimelineStage,
  completeTimelineStage,
  createIdentityMask,
} from '../timeline';
import type { BeatRange } from '../analysis/types';
import type { CanonicalOutputAdapter } from '../types';

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

const applyMirrorHalfSymmetry = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
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

  const keepMin = effect.params.axis === 'horizontal'
    ? effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'tl'
    : effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'br';
  const mirrorTransform = toAxisMirrorTransformAt(effect.params.axis, COMPOSITION_CENTER);
  const boundary = effect.params.axis === 'horizontal' ? COMPOSITION_CENTER.x : COMPOSITION_CENTER.y;

  forEachTargetedFrame(nextTimeline, state.timeline.frames.length, targetGroupId, frameWindow, (frameIndex, targeted) => {
    for (const stroke of targeted) {
      const sourceHalfMask = createIdentityMask((x, y) => isWithinHalfBoundary(
        effect.params.axis === 'horizontal' ? x : y,
        boundary,
        keepMin,
      ));
      addStrokeToFrame(nextTimeline, frameIndex, {
        ...cloneStrokeWithWriteOrder(stroke, writeOrder),
        masks: [...stroke.masks.map(cloneMask), sourceHalfMask],
      });

      const mirroredHalfMask = createIdentityMask((x, y) => isWithinHalfBoundary(
        effect.params.axis === 'horizontal' ? x : y,
        boundary,
        !keepMin,
      ));
      const mirroredStroke = transformStroke(stroke, mirrorTransform, writeOrder);
      addStrokeToFrame(nextTimeline, frameIndex, {
        ...mirroredStroke,
        masks: [...mirroredStroke.masks, mirroredHalfMask],
      });
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

const applyQuadMirrorSymmetry = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
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

  const quadrants: ReadonlyArray<SymmetryEffectNode['params']['sourceAnchor']> = ['bl', 'br', 'tr', 'tl'];
  const sourceKeepMinX = effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'tl';
  const sourceKeepMinY = effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'br';

  forEachTargetedFrame(nextTimeline, state.timeline.frames.length, targetGroupId, frameWindow, (frameIndex, targeted) => {
    for (const stroke of targeted) {
      for (const quadrant of quadrants) {
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
        addStrokeToFrame(nextTimeline, frameIndex, {
          ...transformedStroke,
          masks: [...transformedStroke.masks, quadrantMask],
        });
      }
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

const applyQuadPinwheelSymmetry = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
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

  const quadrants: ReadonlyArray<SymmetryEffectNode['params']['sourceAnchor']> = ['bl', 'br', 'tr', 'tl'];
  const sourceIndex = quadrants.findIndex((quadrant) => quadrant === effect.params.sourceAnchor);

  forEachTargetedFrame(nextTimeline, state.timeline.frames.length, targetGroupId, frameWindow, (frameIndex, targeted) => {
    for (const stroke of targeted) {
      for (let targetIndex = 0; targetIndex < quadrants.length; targetIndex += 1) {
        const quadrant = quadrants[targetIndex];
        const delta = (targetIndex - sourceIndex + quadrants.length) % quadrants.length;
        const angleDeg = delta * 90;
        const transform = angleDeg === 0 ? null : toRotateTransformAt(angleDeg, COMPOSITION_CENTER);
        const quadrantMask = createIdentityMask((x, y) => isInQuadrant(x, y, quadrant));
        const transformedStroke = transformStroke(stroke, transform, writeOrder);
        addStrokeToFrame(nextTimeline, frameIndex, {
          ...transformedStroke,
          masks: [...transformedStroke.masks, quadrantMask],
        });
      }
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

const applySymmetryEffect = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  if (effect.params.mode === 'mirror-half') {
    return applyMirrorHalfSymmetry(
      state,
      effect,
      targetGroupId,
      writeOrder,
      requiredFrameWindow,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    );
  }

  if (effect.params.mode === 'quad-mirror') {
    return applyQuadMirrorSymmetry(
      state,
      effect,
      targetGroupId,
      writeOrder,
      requiredFrameWindow,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    );
  }

  return applyQuadPinwheelSymmetry(
    state,
    effect,
    targetGroupId,
    writeOrder,
    requiredFrameWindow,
    outputAdapter,
    mutedGroupIds,
    mutedGeneratorIds,
  );
};

export const symmetryOperator = createRackOperator<'symmetry'>(
  materializeRackOperatorInput,
  (state, stage, context) => {
    const device = stage.device;
    const executionPlan = resolveStageExecutionPlan(context, stage);

    return applySymmetryEffect(
      state,
      device,
      stage.groupId,
      stage.stageIndex,
      executionPlan.requiredFrameWindow,
      context.outputAdapter,
      context.mutedGroupIds,
      context.mutedGeneratorIds,
    );
  },
);
