import type { ChainMutationMeta } from './history-core';
import {
  assignGroupIdToDevices,
  canCreateGroupFromSelection,
  removeDevicesById,
  resolveGroupMemberIds,
  resolveNextGroupId,
} from './chain-ops';
import {
  applyGroupEnabledChange,
  EDITOR_HISTORY_META,
} from './commands';
import { resolveDeleteSelectionDeviceIds } from './selectors';
import type { EditorRackBinding, EditorSessionState } from './session.svelte';

interface GroupingContext {
  state: EditorSessionState;
  rackBinding: EditorRackBinding | null;
  applyChainMutation: (
    nextChain: EditorSessionState['chainState'],
    meta: ChainMutationMeta,
  ) => void;
}

const handoffDeviceSelection = (
  context: GroupingContext,
  removedDeviceIds: readonly string[],
  replacementDeviceIds: readonly string[] = [],
  nextOrderedDeviceIds?: readonly string[],
): void => {
  const rackBinding = context.rackBinding;
  if (!rackBinding) {
    return;
  }

  if (replacementDeviceIds.length === 0) {
    rackBinding.applyNextSelectionAfterDelete(removedDeviceIds);
    return;
  }

  const removedIdSet = new Set(removedDeviceIds);
  const selectedDeviceIds = rackBinding.getOrderedSelectedDeviceIds();
  if (!selectedDeviceIds.some((id) => removedIdSet.has(id))) {
    return;
  }

  const preservedDeviceIds = selectedDeviceIds.filter((id) => !removedIdSet.has(id));
  rackBinding.setSelectedDeviceIds(
    [...preservedDeviceIds, ...replacementDeviceIds],
    nextOrderedDeviceIds,
  );
};

export const deleteDevicesById = (
  context: GroupingContext,
  deviceIds: readonly string[],
  meta: ChainMutationMeta = EDITOR_HISTORY_META.deleteDevices,
): boolean => {
  handoffDeviceSelection(context, deviceIds);
  const nextChain = removeDevicesById(context.state.chainState, deviceIds);
  if (!nextChain) {
    return false;
  }

  context.applyChainMutation(nextChain, meta);
  return true;
};

export const toggleGroupEnabled = (
  context: GroupingContext,
  groupId: string,
  nextEnabled: boolean,
): void => {
  const nextChain = applyGroupEnabledChange(
    context.state.chainState,
    groupId,
    nextEnabled,
  );
  if (!nextChain) {
    return;
  }

  context.applyChainMutation(nextChain, EDITOR_HISTORY_META.groupToggleEnabled);
};

export const deleteGroup = (
  context: GroupingContext,
  rawGroupId: string,
  meta: ChainMutationMeta = EDITOR_HISTORY_META.deleteDevices,
): boolean => {
  const memberIds = resolveGroupMemberIds(context.state.chainState.devices, rawGroupId);
  if (memberIds.length === 0) {
    return false;
  }

  return deleteDevicesById(context, memberIds, meta);
};

const setGroupIdForDevices = (
  context: GroupingContext,
  deviceIds: readonly string[],
  groupId: string | null,
  meta: ChainMutationMeta,
): boolean => {
  const nextChain = assignGroupIdToDevices(context.state.chainState, deviceIds, groupId);
  if (!nextChain) {
    return false;
  }

  context.applyChainMutation(nextChain, meta);
  return true;
};

export const ungroupGroup = (
  context: GroupingContext,
  rawGroupId: string,
  meta: ChainMutationMeta = EDITOR_HISTORY_META.groupUngroup,
): boolean => {
  const memberIds = resolveGroupMemberIds(context.state.chainState.devices, rawGroupId);
  if (memberIds.length === 0) {
    return false;
  }

  return setGroupIdForDevices(context, memberIds, null, meta);
};

export const deleteCurrentSelection = (
  context: GroupingContext,
): boolean => {
  const rackBinding = context.rackBinding;
  if (!rackBinding) {
    return false;
  }

  const targetIds = resolveDeleteSelectionDeviceIds(
    context.state.chainState,
    rackBinding.getSelectedGroupContexts(),
    rackBinding.getOrderedSelectedDeviceIds(),
  );
  if (targetIds.length === 0) {
    return false;
  }

  return deleteDevicesById(context, targetIds);
};

export const groupDeviceIds = (
  context: GroupingContext,
  targetIds: readonly string[],
): boolean => {
  if (!canCreateGroupFromSelection(context.state.chainState.devices, targetIds)) {
    return false;
  }

  return setGroupIdForDevices(
    context,
    targetIds,
    resolveNextGroupId(context.state.chainState.devices),
    EDITOR_HISTORY_META.groupCreate,
  );
};

export const groupCurrentSelection = (
  context: GroupingContext,
): boolean => {
  const rackBinding = context.rackBinding;
  if (!rackBinding) {
    return false;
  }

  const selectedGroups = rackBinding.getSelectedGroupContexts();
  if (selectedGroups.length > 0) {
    return false;
  }

  return groupDeviceIds(context, rackBinding.getOrderedSelectedDeviceIds());
};

export const ungroupSelectedGroups = (
  context: GroupingContext,
): boolean => {
  const rackBinding = context.rackBinding;
  if (!rackBinding) {
    return false;
  }

  let didChange = false;
  for (const selectedGroup of rackBinding.getSelectedGroupContexts()) {
    if (ungroupGroup(context, selectedGroup.groupId, EDITOR_HISTORY_META.groupUngroup)) {
      didChange = true;
    }
  }
  return didChange;
};
