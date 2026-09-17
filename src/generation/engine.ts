import { resolveMutedSources } from '../core/pipeline/groups';
import { executeCompiledRackPlan } from './operators';
import { buildCompiledRackPlan } from './plan/compile';
import type {
  CanonicalFieldResult,
  CanonicalOutputAdapter,
  GenerationExecutionContext,
} from './types';
import type { GeneratorChain } from '../shared/model';

export const buildCanonicalFieldResult = (
  chain: GeneratorChain,
  outputAdapter: CanonicalOutputAdapter,
  executionContext: GenerationExecutionContext,
): CanonicalFieldResult => {
  const compiledPlan = buildCompiledRackPlan(chain);
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(compiledPlan.baseChain);
  const timeline = executeCompiledRackPlan(
    compiledPlan,
    chain,
    outputAdapter,
    executionContext.generatorOutputBounds,
    mutedGroupIds,
    mutedGeneratorIds,
  );

  return {
    timeline,
    mutedGroupIds,
    mutedGeneratorIds,
  };
};
