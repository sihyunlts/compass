import {
  isGeneratorDeviceKind,
  isGeneratorNode,
  type GeneratorChain,
} from '../../../shared/model';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import type { CompiledRackStage } from '../../plan/types';
import type {
  GeneratorStageKind,
  MaskSourceReferenceContext,
  RackStageExecutionContext,
  RackStageOfKind,
} from './types';

export const createRackStageExecutionContext = (
  referenceContext: MaskSourceReferenceContext,
): RackStageExecutionContext => ({
  compiledPlan: referenceContext.compiledPlan,
  outputAdapter: referenceContext.outputAdapter,
  modulationContext: referenceContext.modulationContext,
  executionPlanByDeviceId: referenceContext.executionPlanByDeviceId,
  mutedGroupIds: referenceContext.mutedGroupIds,
  mutedGeneratorIds: referenceContext.mutedGeneratorIds,
  referenceContext,
});

const isGeneratorStage = (
  stage: CompiledRackStage,
): stage is RackStageOfKind<GeneratorStageKind> => isGeneratorDeviceKind(stage.deviceKind);

const isReferenceGeneratorStage = (
  stage: CompiledRackStage,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): boolean => {
  if (!isGeneratorStage(stage)) {
    return false;
  }

  return sourceKind === 'group'
    ? stage.groupId === sourceId
    : stage.deviceId === sourceId;
};

const resolveGeneratorGroupId = (
  chain: GeneratorChain,
  generatorId: string,
): string | null | undefined => {
  const generator = chain.devices.find((device) => (
    device.id === generatorId
    && isGeneratorNode(device)
  ));

  return generator ? normalizeOptionalId(generator.groupId) : undefined;
};

const isReferenceEffectStage = (
  stage: CompiledRackStage,
  context: MaskSourceReferenceContext,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): boolean => {
  if (isGeneratorStage(stage)) {
    return false;
  }

  if (sourceKind === 'group') {
    return stage.groupId === sourceId;
  }

  const sourceGroupId = resolveGeneratorGroupId(context.compiledPlan.baseChain, sourceId);
  if (sourceGroupId === undefined) {
    return false;
  }

  return stage.groupId === sourceGroupId;
};

export const shouldApplyReferenceStage = (
  stage: CompiledRackStage,
  context: MaskSourceReferenceContext,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): boolean => isReferenceGeneratorStage(stage, sourceKind, sourceId)
  || isReferenceEffectStage(stage, context, sourceKind, sourceId);

export const resolveMaskReferenceMutedGroupIds = (
  context: MaskSourceReferenceContext,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): Set<string> => {
  const mutedGroupIds = new Set(context.mutedGroupIds);
  if (sourceKind === 'group') {
    mutedGroupIds.delete(sourceId);
    return mutedGroupIds;
  }

  const sourceGroupId = resolveGeneratorGroupId(context.compiledPlan.baseChain, sourceId);
  if (sourceGroupId) {
    mutedGroupIds.delete(sourceGroupId);
  }
  return mutedGroupIds;
};

export const resolveMaskReferenceMutedGeneratorIds = (
  context: MaskSourceReferenceContext,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): Set<string> => {
  const mutedGeneratorIds = new Set(context.mutedGeneratorIds);
  if (sourceKind === 'generator') {
    mutedGeneratorIds.delete(sourceId);
  }
  return mutedGeneratorIds;
};
