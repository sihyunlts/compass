import { doesDeviceToggleTimelineParity } from '../../devices/timeline-parity';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import type { GeneratorChain, MaskEffectNode } from '../../shared/model';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { OperatorExecutionPlan } from '../analysis/types';
import {
  collectOccupiedCoordinates,
  createCoordinateMask,
} from '../timeline/analysis';
import {
  addStrokeToFrame,
  beginTimelineStage,
  completeTimelineStage,
  createIdentityMask,
} from '../timeline';
import type { CanonicalOutputAdapter, GeometryMask, GeometryTimeline } from '../types';
import {
  clonePendingTemporalWriteOrderByOriginId,
  cloneSealedOriginIds,
  type MutableGenerationState,
} from '../timeline/state';
import {
  buildTimelineStateByOriginId,
  cloneMask,
  cloneStrokeWithWriteOrder,
  createRackOperator,
  forEachTargetedFrame,
  resolveFrameWindow,
  resolveStageExecutionPlan,
  sealRackOperatorInput,
  type MaskSourceReferenceContext,
} from './runtime';

const resolveMaskSourceTimeReversed = (
  chain: GeneratorChain,
  targetGroupId: string | null,
  consumingDeviceIndex: number,
): boolean => {
  let reverseParity = false;

  for (let index = chain.devices.length - 1; index > consumingDeviceIndex; index -= 1) {
    const device = chain.devices[index];
    const deviceGroupId = normalizeOptionalId(device.groupId);
    const affectsTarget = deviceGroupId === null || deviceGroupId === targetGroupId;
    if (
      affectsTarget
      && isDeviceEffectivelyEnabled(chain, device)
      && doesDeviceToggleTimelineParity(device)
    ) {
      reverseParity = !reverseParity;
    }
  }

  return reverseParity;
};

const resolveMaskSourceTimeline = (
  currentTimeline: GeometryTimeline,
  effect: MaskEffectNode,
  referenceContext: MaskSourceReferenceContext,
): GeometryTimeline => {
  if (effect.params.sourceKind === 'tiles') {
    return currentTimeline;
  }

  const sourceId = normalizeOptionalId(effect.params.sourceId);
  if (!sourceId) {
    return currentTimeline;
  }

  const referenceTimeline = referenceContext.resolveReferenceTimeline(
    effect.params.sourceKind,
    sourceId,
  );
  return referenceTimeline ?? currentTimeline;
};

const resolveMaskSourceMask = (
  sourceTimeline: GeometryTimeline,
  chain: GeneratorChain,
  effect: MaskEffectNode,
  consumingDeviceIndex: number,
  outputAdapter: CanonicalOutputAdapter,
  targetGroupId: string | null,
  frameIndex: number,
): GeometryMask => {
  if (effect.params.sourceKind === 'tiles') {
    const mask = outputAdapter.createMaskFromViewportTiles(effect.params.tiles);
    return createIdentityMask(mask.contains);
  }

  const sourceId = normalizeOptionalId(effect.params.sourceId);
  if (!sourceId) {
    return createIdentityMask(() => false);
  }

  const isTimeReversed = resolveMaskSourceTimeReversed(
    chain,
    targetGroupId,
    consumingDeviceIndex,
  );
  const resolvedFrameIndex = isTimeReversed
    ? Math.max(sourceTimeline.frames.length - 1 - frameIndex, 0)
    : frameIndex;
  if (resolvedFrameIndex < 0 || resolvedFrameIndex >= sourceTimeline.frames.length) {
    return createIdentityMask(() => false);
  }

  const sourceStrokes = sourceTimeline.frames[resolvedFrameIndex].strokes.filter((stroke) => (
    effect.params.sourceKind === 'group'
      ? stroke.originGroupId === sourceId
      : stroke.polyline.originId === sourceId
  ));
  const coordinates = collectOccupiedCoordinates(
    sourceStrokes,
    effect.params.sourceDomain === 'activation',
  );
  return createIdentityMask(createCoordinateMask(coordinates));
};

const applyMaskEffect = (
  state: MutableGenerationState,
  chain: GeneratorChain,
  effect: MaskEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  consumingDeviceIndex: number,
  outputAdapter: CanonicalOutputAdapter,
  executionPlan: OperatorExecutionPlan,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
  referenceContext: MaskSourceReferenceContext,
): MutableGenerationState => {
  const sourceTimeline = resolveMaskSourceTimeline(
    state.timeline,
    effect,
    referenceContext,
  );
  const nextTimeline = beginTimelineStage(state.timeline);
  const targetFrameWindow = resolveFrameWindow(
    executionPlan.requiredFrameWindow,
    state.timeline.sampleStepBeats,
    sourceTimeline.frames.length,
  );

  forEachTargetedFrame(nextTimeline, sourceTimeline.frames.length, targetGroupId, targetFrameWindow, (frameIndex, targeted) => {
    const mask = resolveMaskSourceMask(
      sourceTimeline,
      chain,
      effect,
      consumingDeviceIndex,
      outputAdapter,
      targetGroupId,
      frameIndex,
    );

    for (const stroke of targeted) {
      addStrokeToFrame(nextTimeline, frameIndex, {
        ...cloneStrokeWithWriteOrder(stroke, writeOrder),
        masks: [
          ...stroke.masks.map(cloneMask),
          effect.params.mode === 'include'
            ? mask
            : createIdentityMask((x, y) => !mask.contains(x, y)),
        ],
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


export const maskOperator = createRackOperator<'mask'>(
  sealRackOperatorInput,
  (state, stage, context) => {
    const device = stage.device;
    const executionPlan = resolveStageExecutionPlan(context, stage);

    return applyMaskEffect(
      state,
      context.compiledPlan.baseChain,
      device,
      stage.groupId,
      stage.stageIndex,
      stage.stageIndex,
      context.outputAdapter,
      executionPlan,
      context.mutedGroupIds,
      context.mutedGeneratorIds,
      context.referenceContext,
    );
  },
);
