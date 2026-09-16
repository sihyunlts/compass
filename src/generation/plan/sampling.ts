import { resolveTimeWarpCurveMaxRate } from '../../core/timewarp/curve';
import { MIN_NOTE_DURATION } from '../../core/pipeline/constants';
import { DEFAULT_SAMPLE_STEP_BEATS } from '../timeline';
import type { CompiledRackPlan } from './types';

const MAX_TEMPORAL_OVERSAMPLING_FACTOR = 8;
// One sample can retain a color slot yet still miss its moving spatial support.
// Keep at least two samples across the requested width, down to note precision.
const MIN_SAMPLES_PER_COLOR_INTERVAL = 2;

class TimelineSamplingRefinement extends Error {
  constructor(readonly sampleStepBeats: number) {
    super('The timeline needs finer sampling to represent its color intervals.');
  }
}

/** Refine the time grid instead of widening a color interval to fit that grid. */
export const requireColorIntervalResolution = (
  sampleStepBeats: number,
  spanFrames: number,
): void => {
  if (spanFrames >= MIN_SAMPLES_PER_COLOR_INTERVAL - 1e-9
    || sampleStepBeats <= MIN_NOTE_DURATION) return;
  const refinementFactor = 2 ** Math.ceil(Math.log2(MIN_SAMPLES_PER_COLOR_INTERVAL / spanFrames));
  throw new TimelineSamplingRefinement(Math.max(
    sampleStepBeats / refinementFactor,
    MIN_NOTE_DURATION,
  ));
};

export const withAdaptiveTimelineSampling = <T>(
  initialSampleStepBeats: number,
  render: (sampleStepBeats: number) => T,
): T => {
  let sampleStepBeats = initialSampleStepBeats;
  for (;;) {
    try {
      return render(sampleStepBeats);
    } catch (error) {
      if (!(error instanceof TimelineSamplingRefinement)) throw error;
      // Re-evaluate geometry at the new times; duplicating coarse poses would
      // preserve the missed crossings. Each attempt owns fresh reference caches.
      sampleStepBeats = error.sampleStepBeats;
    }
  }
};

const resolveTemporalOversamplingFactor = (
  compiledPlan: CompiledRackPlan,
): number => {
  let combinedRate = 1;

  for (const stage of compiledPlan.stages) {
    if (stage.device.kind === 'timewarp') {
      combinedRate *= resolveTimeWarpCurveMaxRate(stage.device.params.curve);
    } else if (stage.device.kind === 'repeat') {
      const intervalRatio = stage.device.params.intervalPercent / 100;
      combinedRate *= 1 + (stage.device.params.count - 1) * intervalRatio;
    }
    if (combinedRate >= MAX_TEMPORAL_OVERSAMPLING_FACTOR) {
      return MAX_TEMPORAL_OVERSAMPLING_FACTOR;
    }
  }

  return Math.min(
    Math.max(Math.ceil(combinedRate), 1),
    MAX_TEMPORAL_OVERSAMPLING_FACTOR,
  );
};

export const resolveCompiledRackSampleStepBeats = (
  compiledPlan: CompiledRackPlan,
): number => DEFAULT_SAMPLE_STEP_BEATS / resolveTemporalOversamplingFactor(compiledPlan);
