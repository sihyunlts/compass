import {
  isGeneratorEngineNode,
  isPipelineEffectNode,
  resolveEffectMutedSource,
  type PipelineEffectNode,
} from '../../devices/engine';
import type { GeneratorChain, GeneratorDeviceNode, GeneratorNode } from '../../shared/model';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type {
  GroupChain,
  GroupEvaluationContext,
  GroupId,
  MaskTimeKind,
} from './types';

export const isGeneratorNode = (device: GeneratorDeviceNode): device is GeneratorNode => (
  isGeneratorEngineNode(device)
);

export const isEffectNode = (device: GeneratorDeviceNode): device is PipelineEffectNode => (
  isPipelineEffectNode(device)
);

export const splitChainByGroup = (chain: GeneratorChain): GroupChain[] => {
  const groups: GroupChain[] = [];
  const byId = new Map<GroupId, GroupChain>();

  for (const device of chain.devices) {
    const groupId = normalizeOptionalId(device.groupId);
    let group = byId.get(groupId);
    if (!group) {
      group = { id: groupId, devices: [] };
      byId.set(groupId, group);
      groups.push(group);
    }
    group.devices.push(device);
  }

  return groups;
};

export const resolveMaskTime = (
  context: GroupEvaluationContext,
  timeKind: MaskTimeKind,
): number => (timeKind === 'reversed' ? context.timeReversed : context.time);

export const resolveMutedSources = (
  chain: GeneratorChain,
): {
  mutedGroupIds: Set<string>;
  mutedGeneratorIds: Set<string>;
} => {
  const mutedGroupIds = new Set<string>();
  const mutedGeneratorIds = new Set<string>();

  for (const device of chain.devices) {
    if (!isDeviceEffectivelyEnabled(chain, device)) {
      continue;
    }

    const mutedSource = resolveEffectMutedSource(device);
    if (!mutedSource) {
      continue;
    }

    if (mutedSource.kind === 'group') {
      mutedGroupIds.add(mutedSource.sourceId);
    } else {
      mutedGeneratorIds.add(mutedSource.sourceId);
    }
  }

  return { mutedGroupIds, mutedGeneratorIds };
};
