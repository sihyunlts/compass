import { resolveTimeWarpCurveMaxRate } from '../../core/timewarp/curve';
import { DEFAULT_SAMPLE_STEP_BEATS } from '../timeline';
import type { CompiledRackPlan } from './types';

const MAX_TEMPORAL_OVERSAMPLING_FACTOR = 8;

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
