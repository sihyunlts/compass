import type {
  GeneratorChain,
  GeneratorDeviceNode,
  GeneratorEffectNode,
  GeneratorNode,
} from '../../shared/types';
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
);

export const isEffectNode = (device: GeneratorDeviceNode): device is GeneratorEffectNode => (
  device.kind === 'mirror'
  || device.kind === 'mask'
  || device.kind === 'symmetry'
  || device.kind === 'rotate'
  || device.kind === 'reverse'
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

export const pickByTimeKind = <T>(
  timeKind: MaskTimeKind,
  forward: T,
  reversed: T,
): T => (timeKind === 'reversed' ? reversed : forward);

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
    if (device.kind !== 'mask' || !isDeviceEffectivelyEnabled(chain, device)) {
      continue;
    }

    if (device.params.sourceVisibility === 'show') {
      continue;
    }

    const sourceKind = device.params.sourceKind ?? 'tiles';
    if (sourceKind !== 'group' && sourceKind !== 'generator') {
      continue;
    }

    const sourceId = normalizeOptionalId(device.params.sourceId);
    if (!sourceId) {
      continue;
    }

    if (sourceKind === 'group') {
      mutedGroupIds.add(sourceId);
    } else {
      mutedGeneratorIds.add(sourceId);
    }
  }

  return { mutedGroupIds, mutedGeneratorIds };
};
