import {
  isRackSelectionContextTarget,
  type ContextMenuTarget,
} from '../context-menu/types';
import type { GroupSelectionContext } from '../rack/selection.svelte';
import type { GeneratorChain } from '../../../shared/model';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import { resolveExistingOrderedDeviceIds } from './chain-ops';
import { sanitizePreviewBpm } from './persistence-storage';
import type { ChainHistoryKind } from './history-core';

export type RackSelectionItemSnapshot =
  | {
      kind: 'device';
      deviceId: string;
    }
  | {
      kind: 'group';
      groupId: string;
      memberDeviceIds: string[];
    };

export interface RackSelectionSnapshot {
  items: RackSelectionItemSnapshot[];
  deviceIds: string[];
}

export const selectPreviewBpmText = (previewBpm: number): string =>
  `BPM ${sanitizePreviewBpm(previewBpm).toFixed(2)}`;

export const selectHistoryControls = (state: {
  canUndo: boolean;
  canRedo: boolean;
  undoActionKind: ChainHistoryKind | null;
  redoActionKind: ChainHistoryKind | null;
}) => ({
  canUndo: state.canUndo,
  canRedo: state.canRedo,
  undoActionKind: state.undoActionKind,
  redoActionKind: state.redoActionKind,
});

export const selectClipboardAvailable = (state: {
  clipboardAvailable: boolean;
}): boolean => state.clipboardAvailable;

const toGroupSelectionItemSnapshot = (
  chain: GeneratorChain,
  groupId: string,
  memberDeviceIds: readonly string[],
): Extract<RackSelectionItemSnapshot, { kind: 'group' }> | null => {
  const resolvedMemberDeviceIds = resolveExistingOrderedDeviceIds(
    chain.devices,
    memberDeviceIds,
  );
  if (resolvedMemberDeviceIds.length === 0) {
    return null;
  }
  return {
    kind: 'group',
    groupId,
    memberDeviceIds: resolvedMemberDeviceIds,
  };
};

export const resolveCurrentSelectionSnapshot = (
  chain: GeneratorChain,
  selectedGroups: readonly GroupSelectionContext[],
  selectedDeviceIds: readonly string[],
): RackSelectionSnapshot | null => {
  const selectedGroupById = new Map(
    selectedGroups.map((group): [string, GroupSelectionContext] => [group.groupId, group]),
  );
  const selectedDeviceIdSet = new Set(selectedDeviceIds);
  const emittedGroupIds = new Set<string>();
  const items: RackSelectionItemSnapshot[] = [];
  const resolvedDeviceIds = new Set<string>();

  for (const device of chain.devices) {
    const groupId = normalizeOptionalId(device.groupId);
    const selectedGroup = groupId ? selectedGroupById.get(groupId) : undefined;
    if (selectedGroup) {
      if (!emittedGroupIds.has(groupId)) {
        const item = toGroupSelectionItemSnapshot(
          chain,
          groupId,
          selectedGroup.memberDeviceIds,
        );
        if (item) {
          items.push(item);
          for (const memberDeviceId of item.memberDeviceIds) {
            resolvedDeviceIds.add(memberDeviceId);
          }
        }
        emittedGroupIds.add(groupId);
      }
      continue;
    }

    if (!selectedDeviceIdSet.has(device.id)) {
      continue;
    }

    items.push({ kind: 'device', deviceId: device.id });
    resolvedDeviceIds.add(device.id);
  }

  return items.length > 0
    ? { items, deviceIds: [...resolvedDeviceIds] }
    : null;
};

export const resolveSelectionSnapshotFromContextTarget = (
  chain: GeneratorChain,
  target: ContextMenuTarget,
): RackSelectionSnapshot | null => {
  if (!isRackSelectionContextTarget(target)) {
    return null;
  }

  if (target.kind === 'group') {
    const item = toGroupSelectionItemSnapshot(
      chain,
      target.groupId,
      target.memberDeviceIds,
    );
    return item
      ? { items: [item], deviceIds: [...item.memberDeviceIds] }
      : null;
  }

  const deviceIds = resolveExistingOrderedDeviceIds(chain.devices, target.deviceIds);
  if (deviceIds.length === 0) {
    return null;
  }

  return {
    items: deviceIds.map((deviceId) => ({ kind: 'device', deviceId })),
    deviceIds,
  };
};

export const resolveDeleteSelectionDeviceIds = (
  chain: GeneratorChain,
  selectedGroups: readonly GroupSelectionContext[],
  selectedDeviceIds: readonly string[],
): string[] => {
  const deleteIdSet = new Set(selectedDeviceIds);
  for (const selectedGroup of selectedGroups) {
    for (const memberId of selectedGroup.memberDeviceIds) {
      deleteIdSet.add(memberId);
    }
  }

  return resolveExistingOrderedDeviceIds(chain.devices, [...deleteIdSet]);
};
