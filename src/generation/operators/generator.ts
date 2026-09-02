import {
  createRackOperator,
  replaceTimelineAndRefreshRackState,
  resolveModulatedDeviceAtFrame,
  seedGeneratedOriginTimelineState,
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
  toFrameCount,
} from '../timeline';
import { FIXED_TIMELINE_END_BEAT } from '../timeline/temporal-window';

const applyGeneratorDevice = (
  state: MutableGenerationState,
  stage: RackStageOfKind<GeneratorStageKind>,
  context: RackStageExecutionContext,
): MutableGenerationState => {
  const device = stage.device;
  const nextTimeline = beginTimelineStage(state.timeline);
  // Generators author one canonical pattern. The field result scales that
  // complete pattern to the requested clip length after rack evaluation.
  const generatorPatternEndBeat = FIXED_TIMELINE_END_BEAT;
  const generatorEvaluationWindow = {
    start: 0,
    end: generatorPatternEndBeat,
  };
  ensureTimelineFrameCount(nextTimeline, generatorPatternEndBeat);
  const frameCount = toFrameCount(generatorPatternEndBeat, nextTimeline.sampleStepBeats);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    rasterizeGeneratorFrame(
      nextTimeline,
      frameIndex,
      resolveModulatedDeviceAtFrame(
        context.modulationContext,
        device,
        frameIndex,
        nextTimeline.sampleStepBeats,
        generatorEvaluationWindow,
      ),
      stage.stageIndex,
      context.generatorOutputBounds,
    );
  }

  const completedTimeline = completeTimelineStage(nextTimeline);
  const preservesFullPlaybackWindow = device.kind === 'rain';
  return replaceTimelineAndRefreshRackState(
    state,
    completedTimeline,
    seedGeneratedOriginTimelineState(
      state.timelineStateByOriginId,
      stage.deviceId,
      preservesFullPlaybackWindow ? 'fixed' : 'natural',
    ),
    context,
  );
};

export const generatorOperator = createRackOperator<GeneratorStageKind, 'preserve-pending'>(
  'preserve-pending',
  (state, stage, context) => applyGeneratorDevice(state, stage, context),
);
