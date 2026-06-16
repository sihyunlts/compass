import { resolveMutedSources } from '../core/pipeline/groups';
import { buildCanonicalExecutionPlan } from './analysis/execution-plan';
import type {
  CanonicalExecutionRequest,
} from './analysis/types';
import { executeCompiledRackPlan } from './operators';
import { buildCompiledRackPlan } from './plan/compile';
import { finalizeTimeline } from './timeline';
import type {
  CanonicalFieldResult,
  CanonicalOutputAdapter,
} from './types';
import type { GeneratorChain } from '../shared/model';

export const buildCanonicalFieldResult = (
  chain: GeneratorChain,
  loopLengthBeats: number,
  outputAdapter: CanonicalOutputAdapter,
  executionRequest: CanonicalExecutionRequest,
): CanonicalFieldResult => {
  const compiledPlan = buildCompiledRackPlan(chain);
  const executionPlan = buildCanonicalExecutionPlan(compiledPlan.baseChain, executionRequest);
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(compiledPlan.baseChain);
  const executionState = executeCompiledRackPlan(
    compiledPlan,
    chain,
    loopLengthBeats,
    outputAdapter,
    executionPlan.byDeviceId,
    mutedGroupIds,
    mutedGeneratorIds,
  );
  const timeline = finalizeTimeline(executionState.timeline);

  return {
    loopLengthBeats,
    timeline,
    sourceTimelineEndBeat: loopLengthBeats,
    sampleStepBeats: timeline.sampleStepBeats,
    mutedGroupIds,
    mutedGeneratorIds,
    analysis: compiledPlan.analysis,
    executionPlan,
    compiledPlan,
    timelineStateByOriginId: executionState.timelineStateByOriginId,
  };
};
