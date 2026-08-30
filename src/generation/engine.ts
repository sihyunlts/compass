import { resolveMutedSources } from '../core/pipeline/groups';
import { executeCompiledRackPlan } from './operators';
import { buildCompiledRackPlan } from './plan/compile';
import { finalizeTimeline } from './timeline';
import type {
  CanonicalFieldResult,
  CanonicalOutputAdapter,
  GenerationExecutionContext,
} from './types';
import type { GeneratorChain } from '../shared/model';

export const buildCanonicalFieldResult = (
  chain: GeneratorChain,
  loopLengthBeats: number,
  outputAdapter: CanonicalOutputAdapter,
  executionContext: GenerationExecutionContext,
): CanonicalFieldResult => {
  const compiledPlan = buildCompiledRackPlan(chain);
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(compiledPlan.baseChain);
  const executionState = executeCompiledRackPlan(
    compiledPlan,
    chain,
    loopLengthBeats,
    outputAdapter,
    executionContext.generatorOutputBounds,
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
    timelineStateByOriginId: executionState.timelineStateByOriginId,
  };
};
