import type { GeneratorChain, GeneratorDeviceNode, GeneratorEffectNode, GeneratorNode } from '../../shared/model';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type {
  GroupChain,
  GroupEvaluationContext,
  GroupId,
  MaskTimeKind,
} from './types';

export const isGeneratorNode = (device: GeneratorDeviceNode): device is GeneratorNode => (
  device.kind === 'waterdrop'
  || device.kind === 'scanner'
  || device.kind === 'spiral'
  || device.kind === 'path'
);

export const isEffectNode = (device: GeneratorDeviceNode): device is GeneratorEffectNode => (
  !isGeneratorNode(device) && device.kind !== 'modulator'
);

const resolveEffectMutedSource = (
  device: GeneratorDeviceNode,
): { kind: 'group' | 'generator'; sourceId: string } | null => {
  if (device.kind !== 'mask' || device.params.sourceVisibility === 'show') {
    return null;
  }

  const sourceKind = device.params.sourceKind;
  if (sourceKind !== 'group' && sourceKind !== 'generator') {
    return null;
  }

  const sourceId = normalizeOptionalId(device.params.sourceId);
  return sourceId ? { kind: sourceKind, sourceId } : null;
};

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
