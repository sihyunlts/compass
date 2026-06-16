import {
  createRackOperator,
  preservePendingRackOperatorInput,
  replaceTimelineAndRefreshRackState,
  resolveFrameWindow,
  resolveModulatedDeviceAtFrame,
  seedGeneratedOriginTimelineState,
  resolveStageExecutionPlan,
  type GeneratorStageKind,
  type RackStageExecutionContext,
  type RackStageOfKind,
} from './runtime';
import { rasterizeGeneratorFrame } from '../raster';
import {
  type MutableGenerationState,
} from '../timeline/state';
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

  const completedTimeline = completeTimelineStage(nextTimeline);
  return replaceTimelineAndRefreshRackState(
    state,
    completedTimeline,
    seedGeneratedOriginTimelineState(state.timelineStateByOriginId, stage.deviceId),
    context,
    [stage.deviceId],
  );
};

export const generatorOperator = createRackOperator<GeneratorStageKind>(
  preservePendingRackOperatorInput,
  (state, stage, context) => applyGeneratorDevice(state, stage, context),
);
