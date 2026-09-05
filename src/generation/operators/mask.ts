import { doesDeviceToggleTimelineParity } from '../../devices/timeline-parity';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import type { GeneratorChain, MaskEffectNode } from '../../shared/model';
import { normalizeOptionalId } from '../../shared/normalize-id';
import {
  collectOccupiedCoordinates,
  createCoordinateMask,
} from '../timeline/analysis';
import {
  createEmptyTimeline,
  createIdentityMask,
  iterateTimelineFrames,
} from '../timeline';
import type { CanonicalOutputAdapter, GeometryMask, GeometryTimeline } from '../types';
import {
  type GenerationState,
} from '../timeline/state';
import {
  buildTargetOriginIds,
  buildPendingStrokeRewriteFrameWrites,
  transformStroke,
  createRackOperator,
  materializeRackState,
  appendPendingStrokeRewriteApplication,
  type MaskSourceReferenceContext,
} from './runtime';

const resolveMaskSourceTimeReversed = (
  chain: GeneratorChain,
  targetGroupId: string | null,
  consumingDeviceId: string,
): boolean => {
  const consumingDeviceIndex = chain.devices.findIndex((device) => device.id === consumingDeviceId);
  if (consumingDeviceIndex < 0) {
    return false;
  }

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

const createMaskFrameResolver = (
  sourceTimeline: GeometryTimeline,
  chain: GeneratorChain,
  effect: MaskEffectNode,
  consumingDeviceId: string,
  outputAdapter: CanonicalOutputAdapter,
  targetGroupId: string | null,
): (frameIndex: number) => GeometryMask => {
  if (effect.params.sourceKind === 'tiles') {
    const mask = outputAdapter.createMaskFromViewportTiles(effect.params.tiles);
    const geometryMask = createIdentityMask(mask.contains);
    return () => geometryMask;
  }

  const sourceId = normalizeOptionalId(effect.params.sourceId);
  if (!sourceId) {
    const emptyMask = createIdentityMask(() => false);
    return () => emptyMask;
  }

  const isTimeReversed = resolveMaskSourceTimeReversed(
    chain,
    targetGroupId,
    consumingDeviceId,
  );
  const sourceFrames = Array.from(iterateTimelineFrames(sourceTimeline));
  return (frameIndex) => {
    const resolvedFrameIndex = isTimeReversed
      ? Math.max(sourceTimeline.frameCount - 1 - frameIndex, 0)
      : frameIndex;
    if (resolvedFrameIndex < 0 || resolvedFrameIndex >= sourceTimeline.frameCount) {
      return createIdentityMask(() => false);
    }

    const sourceStrokes = sourceFrames[resolvedFrameIndex].strokes.filter((stroke) => (
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
};

const applyMaskEffect = (
  state: GenerationState,
  inputTimeline: GeometryTimeline,
  chain: GeneratorChain,
  effect: MaskEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  consumingDeviceId: string,
  outputAdapter: CanonicalOutputAdapter,
  referenceContext: MaskSourceReferenceContext,
): GenerationState => {
  const sourceTimeline = resolveMaskSourceTimeline(
    inputTimeline,
    effect,
    referenceContext,
  );
  const targetFrameWindow = {
    startFrame: 0,
    endFrameExclusive: sourceTimeline.frameCount,
  };
  const targetOriginIds = buildTargetOriginIds(inputTimeline, targetGroupId);
  const resolveMaskAtFrame = createMaskFrameResolver(
    sourceTimeline,
    chain,
    effect,
    consumingDeviceId,
    outputAdapter,
    targetGroupId,
  );
  const writes = buildPendingStrokeRewriteFrameWrites(
    inputTimeline,
    targetOriginIds,
    targetFrameWindow,
    (frameIndex, strokes) => {
      const mask = resolveMaskAtFrame(frameIndex);

      return strokes.map((stroke) => ({
        ...transformStroke(stroke, null, writeOrder),
        masks: [
          ...stroke.masks,
          effect.params.mode === 'include'
            ? mask
            : createIdentityMask((x, y) => !mask.contains(x, y)),
        ],
      }));
    },
  );

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
      context.compiledPlan.baseChain,
      device,
      stage.groupId,
      stage.stageIndex,
      stage.deviceId,
      context.outputAdapter,
      context.referenceContext,
    );
  },
);
