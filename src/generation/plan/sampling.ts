import { resolveTimeWarpCurveMaxRate } from '../../core/timewarp/curve';
import { DEFAULT_SAMPLE_STEP_BEATS } from '../timeline';
import type { CompiledRackPlan } from './types';

const MAX_TEMPORAL_OVERSAMPLING_FACTOR = 8;

const resolveTemporalOversamplingFactor = (
  compiledPlan: CompiledRackPlan,
): number => {
  let combinedRate = 1;

  for (const stage of compiledPlan.stages) {
    if (stage.device.kind !== 'timewarp') {
      continue;
    }

    combinedRate *= resolveTimeWarpCurveMaxRate(stage.device.params.curve);
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
