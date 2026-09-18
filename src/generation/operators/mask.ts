import type { MaskEffectNode } from '../../shared/model';
import { normalizeOptionalId } from '../../shared/normalize-id';
import {
  createGeometryCoordinateMask,
} from '../timeline/analysis';
import {
  createEmptyTimeline,
  createIdentityMask,
  iterateTimelineSpans,
  groupPlacementsByOrigin,
  type FrameWindow,
} from '../timeline';
import type { CanonicalOutputAdapter, GeometryMask, GeometryTimeline } from '../types';
import {
  type GenerationState,
  type PendingStrokeRewriteWrite,
} from '../timeline/state';
import {
  buildTargetOriginIds,
  transformStroke,
  createRackOperator,
  materializeRackState,
  appendPendingStrokeRewriteApplication,
  type MaskSourceReferenceContext,
} from './runtime';

const resolveMaskSourceTimeline = (
  currentTimeline: GeometryTimeline,
  effect: MaskEffectNode,
  referenceContext: MaskSourceReferenceContext,
): GeometryTimeline => {
  if (effect.params.sourceKind === 'tiles') {
    return currentTimeline;
  }

  const result = referenceContext.resolveReference({
    sourceKind: effect.params.sourceKind,
    sourceId: normalizeOptionalId(effect.params.sourceId),
  });
  switch (result.status) {
    case 'resolved':
      return result.timeline;
    case 'unconfigured':
      return currentTimeline;
    case 'cycle':
      return createEmptyTimeline();
  }
};

interface MaskSpan extends FrameWindow {
  mask: GeometryMask;
}

const createMaskFrameResolver = (
  sourceTimeline: GeometryTimeline,
  effect: MaskEffectNode,
  outputAdapter: CanonicalOutputAdapter,
): ((frameIndex: number) => MaskSpan) => {
  const createMask = (contains: GeometryMask['contains']): GeometryMask => createIdentityMask(
    effect.params.mode === 'include' ? contains : (x, y) => !contains(x, y),
  );
  const sourceId = normalizeOptionalId(effect.params.sourceId);
  if (effect.params.sourceKind === 'tiles' || !sourceId) {
    const contains = effect.params.sourceKind === 'tiles'
      ? outputAdapter.createMaskFromViewportTiles(effect.params.tiles).contains
      : () => false;
    const span = { startFrame: 0, endFrameExclusive: sourceTimeline.frameCount, mask: createMask(contains) };
    return () => span;
  }

  const sourceOriginIds = new Set(Array.from(sourceTimeline.originGroupIdByOriginId)
    .filter(([originId, groupId]) => effect.params.sourceKind === 'group'
      ? groupId === sourceId : originId === sourceId)
    .map(([originId]) => originId));
  const spansByFrame = new Array<MaskSpan>(sourceTimeline.frameCount);
  for (const { startFrame, endFrameExclusive, strokes } of iterateTimelineSpans(sourceTimeline, undefined, sourceOriginIds)) {
    spansByFrame.fill({
      startFrame,
      endFrameExclusive,
      mask: createMask(createGeometryCoordinateMask(strokes)),
    }, startFrame, endFrameExclusive);
  }
  return (frameIndex) => spansByFrame[frameIndex];
};

const applyMaskEffect = (
  state: GenerationState,
  inputTimeline: GeometryTimeline,
  effect: MaskEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  outputAdapter: CanonicalOutputAdapter,
  referenceContext: MaskSourceReferenceContext,
): GenerationState => {
  const sourceTimeline = resolveMaskSourceTimeline(
    inputTimeline,
    effect,
    referenceContext,
  );
  const targetOriginIds = buildTargetOriginIds(inputTimeline, targetGroupId);
  const resolveMaskAtFrame = createMaskFrameResolver(
    sourceTimeline,
    effect,
    outputAdapter,
  );
  const writes: PendingStrokeRewriteWrite[] = [];
  // Keep each placement's duration; split only where the source mask changes.
  // One mask instance per span also shares projection results across color ages.
  for (const placements of groupPlacementsByOrigin(inputTimeline, targetOriginIds).values()) {
    for (const { stroke, startFrame, endFrameExclusive } of placements) {
      const end = Math.min(endFrameExclusive, sourceTimeline.frameCount);
      for (let frame = startFrame; frame < end;) {
        const span = resolveMaskAtFrame(frame);
        const nextFrame = Math.min(end, span.endFrameExclusive);
        writes.push({
          startFrame: frame,
          endFrameExclusive: nextFrame,
          strokes: [{
            ...transformStroke(stroke, null, writeOrder),
            masks: [...stroke.masks, span.mask],
          }],
        });
        frame = nextFrame;
      }
    }
  }

  return appendPendingStrokeRewriteApplication(
    state,
    inputTimeline,
    targetOriginIds,
    writes,
  );
};


export const maskOperator = createRackOperator<'mask', 'preserve-pending'>(
  'preserve-pending',
  (state, stage, context) => {
    const device = stage.device;
    // Read baked geometry while keeping the incoming modulation clock until
    // the pending mask rewrite is materialized.
    const inputTimeline = materializeRackState(state, context).timeline;

    return applyMaskEffect(
      state,
      inputTimeline,
      device,
      stage.targetGroupId,
      stage.stageIndex,
      context.outputAdapter,
      context.referenceContext,
    );
  },
);
