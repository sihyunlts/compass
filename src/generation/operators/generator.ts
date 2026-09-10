import {
  createRackOperator,
  isDeviceModulated,
  replaceTimelineAndRefreshRackState,
  resolveModulatedDeviceAtFrame,
  seedGeneratedOriginTimelineState,
  type GeneratorStageKind,
  type RackStageExecutionContext,
  type RackStageOfKind,
} from './runtime';
import {
  rasterizeGeneratorFrame,
  resolveRainGeneratorMaxTravelDurationBeats,
} from '../raster';
import {
  type GenerationState,
} from '../timeline/state';
import {
  beginTimelineStage,
  ensureTimelineFrameCount,
  toFrameCount,
} from '../timeline';
import { FIXED_TIMELINE_END_BEAT } from '../timeline/temporal-window';

const applyGeneratorDevice = (
  state: GenerationState,
  stage: RackStageOfKind<GeneratorStageKind>,
  context: RackStageExecutionContext,
): GenerationState => {
  const device = stage.device;
  const nextTimeline = beginTimelineStage(state.timeline);
  // Generators author one canonical pattern. Rain keeps its natural exit tail;
  // final normalization scales the completed result to the requested clip.
  const generatorPatternEndBeat = FIXED_TIMELINE_END_BEAT;
  const generatorEvaluationWindow = {
    start: 0,
    end: generatorPatternEndBeat,
  };
  const canonicalFrameCount = toFrameCount(
    generatorPatternEndBeat,
    nextTimeline.sampleStepBeats,
  );
  let generatorRenderEndBeat = generatorPatternEndBeat;
  if (device.kind === 'rain') {
    let maxTravelDurationBeats = resolveRainGeneratorMaxTravelDurationBeats(device);
    if (isDeviceModulated(context.modulationContext, device.id)) {
      for (let frameIndex = 0; frameIndex < canonicalFrameCount; frameIndex += 1) {
        const resolvedRain = resolveModulatedDeviceAtFrame(
          context.modulationContext,
          device,
          frameIndex,
          nextTimeline.sampleStepBeats,
          generatorEvaluationWindow,
        );
        maxTravelDurationBeats = Math.max(
          maxTravelDurationBeats,
          resolveRainGeneratorMaxTravelDurationBeats(resolvedRain),
        );
      }
    }
    generatorRenderEndBeat += maxTravelDurationBeats;
  }

  ensureTimelineFrameCount(nextTimeline, generatorRenderEndBeat);
  const frameCount = toFrameCount(generatorRenderEndBeat, nextTimeline.sampleStepBeats);

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    rasterizeGeneratorFrame(
      nextTimeline,
      frameIndex,
      resolveModulatedDeviceAtFrame(
        context.modulationContext,
        device,
        // The exit tail continues the last authored Rain state; it must not
        // start a second modulation cycle after emission has ended.
        device.kind === 'rain'
          ? Math.min(frameIndex, canonicalFrameCount - 1)
          : frameIndex,
        nextTimeline.sampleStepBeats,
        generatorEvaluationWindow,
      ),
      stage.stageIndex,
      context.generatorOutputBounds,
    );
  }

  return replaceTimelineAndRefreshRackState(
    state,
    nextTimeline,
    seedGeneratedOriginTimelineState(
      state.timelineStateByOriginId,
      stage.deviceId,
      'natural',
    ),
    context,
  );
};

export const generatorOperator = createRackOperator<GeneratorStageKind, 'preserve-pending'>(
  'preserve-pending',
  (state, stage, context) => applyGeneratorDevice(state, stage, context),
);
