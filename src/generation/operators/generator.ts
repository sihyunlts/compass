import {
  buildTimelineStateByOriginId,
  createRackOperator,
  materializeRackOperatorInput,
  resolveFrameWindow,
  resolveModulatedDeviceAtFrame,
  resolveStageExecutionPlan,
  type GeneratorStageKind,
  type RackStageExecutionContext,
  type RackStageOfKind,
} from './runtime';
import { createIdentitySceneTemporalState } from '../../core/scene-operators/temporal';
import { rasterizeGeneratorFrame } from '../raster';
import {
  clonePendingTemporalWriteOrderByOriginId,
  cloneSealedOriginIds,
  cloneTimelineStateByOriginId,
  type MutableGenerationState,
} from '../timeline/state';
import { EMPTY_TIMELINE_WINDOW } from '../timeline/temporal-window';
import {
  beginTimelineStage,
  completeTimelineStage,
  ensureTimelineFrameCount,
} from '../timeline';

const applyGeneratorDevice = (
  state: MutableGenerationState,
  stage: RackStageOfKind<GeneratorStageKind>,
  context: RackStageExecutionContext,
): MutableGenerationState => {
  const device = stage.device;
  const nextTimeline = beginTimelineStage(state.timeline);
  ensureTimelineFrameCount(nextTimeline, 1);
  const executionPlan = resolveStageExecutionPlan(context, stage);
  const frameWindow = resolveFrameWindow(
    executionPlan.requiredFrameWindow,
    nextTimeline.sampleStepBeats,
    nextTimeline.frames.length,
  );

  for (let frameIndex = frameWindow.startFrame; frameIndex < frameWindow.endFrameExclusive; frameIndex += 1) {
    rasterizeGeneratorFrame(
      nextTimeline,
      frameIndex,
      resolveModulatedDeviceAtFrame(
        context.modulationContext,
        device,
        frameIndex,
        nextTimeline.sampleStepBeats,
        nextTimeline.timeDomainEndBeat,
      ),
      stage.stageIndex,
      executionPlan.generatorOutputBounds,
    );
  }

  const sealedTimeline = completeTimelineStage(nextTimeline);
  const seededTimelineStateByOriginId = cloneTimelineStateByOriginId(state.timelineStateByOriginId);
  seededTimelineStateByOriginId.set(stage.deviceId, {
    observedWindow: EMPTY_TIMELINE_WINDOW,
    temporal: createIdentitySceneTemporalState(),
  });
  const sealedOriginIds = cloneSealedOriginIds(state.sealedOriginIds);
  sealedOriginIds.delete(stage.deviceId);
  return {
    timeline: sealedTimeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      sealedTimeline,
      seededTimelineStateByOriginId,
      context.outputAdapter,
      context.mutedGroupIds,
      context.mutedGeneratorIds,
    ),
    pendingTemporalWriteOrderByOriginId: clonePendingTemporalWriteOrderByOriginId(
      state.pendingTemporalWriteOrderByOriginId,
    ),
    sealedOriginIds,
  };
};

export const generatorOperator = createRackOperator<GeneratorStageKind>(
  materializeRackOperatorInput,
  (state, stage, context) => applyGeneratorDevice(state, stage, context),
);
