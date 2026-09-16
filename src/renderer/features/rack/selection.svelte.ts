import { SvelteSet } from 'svelte/reactivity';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import type { GeneratorDeviceNode } from '../../../shared/model';
import {
  getOrderedSelectedIds,
  haveSameSelectedIds,
  reconcileOrderedSelection,
  selectSingleOrderedItem,
  toggleOrderedSelection,
} from '../selection/ordered-selection';

/** Selected group metadata used by group-level actions. */
export interface GroupSelectionContext {
  groupId: string;
  memberDeviceIds: string[];
}

export type RackSelectionItem =
  | { kind: 'device'; id: string }
  | { kind: 'group'; id: string };

interface RackSelectionInterval {
  firstDeviceIndex: number;
  lastDeviceIndex: number;
}

interface RackSelectionIndex {
  deviceIds: string[];
  groupIds: string[];
  groupIdByDeviceId: Map<string, string>;
  groupMemberIdsById: Map<string, string[]>;
  groupIntervalById: Map<string, RackSelectionInterval>;
  topLevelItems: RackSelectionItem[];
  navigationItems: RackSelectionItem[];
}

const buildRackSelectionIndex = (
  devices: readonly GeneratorDeviceNode[],
): RackSelectionIndex => {
  const index: RackSelectionIndex = {
    deviceIds: [],
    groupIds: [],
    groupIdByDeviceId: new Map(),
    groupMemberIdsById: new Map(),
    groupIntervalById: new Map(),
    topLevelItems: [],
    navigationItems: [],
  };

  for (let deviceIndex = 0; deviceIndex < devices.length; deviceIndex += 1) {
    const device = devices[deviceIndex];
    const groupId = normalizeOptionalId(device.groupId);
    index.deviceIds.push(device.id);

    if (!groupId) {
      const item: RackSelectionItem = { kind: 'device', id: device.id };
      index.topLevelItems.push(item);
      index.navigationItems.push(item);
      continue;
    }

    index.groupIdByDeviceId.set(device.id, groupId);
    const memberDeviceIds = index.groupMemberIdsById.get(groupId);
    const groupInterval = index.groupIntervalById.get(groupId);
    if (memberDeviceIds && groupInterval) {
      memberDeviceIds.push(device.id);
      groupInterval.lastDeviceIndex = deviceIndex;
    } else {
      index.groupIds.push(groupId);
      index.groupMemberIdsById.set(groupId, [device.id]);
      index.groupIntervalById.set(groupId, {
        firstDeviceIndex: deviceIndex,
        lastDeviceIndex: deviceIndex,
      });
      const groupItem: RackSelectionItem = { kind: 'group', id: groupId };
      index.topLevelItems.push(groupItem);
      index.navigationItems.push(groupItem);
    }
    index.navigationItems.push({ kind: 'device', id: device.id });
  }

  return index;
};

/** Keyboard order where a group is followed by its member devices. */
export const buildRackNavigationItems = (
  devices: readonly GeneratorDeviceNode[],
): RackSelectionItem[] => buildRackSelectionIndex(devices).navigationItems;

const resolveItemInterval = (
  item: RackSelectionItem,
  index: RackSelectionIndex,
): RackSelectionInterval | null => {
  if (item.kind === 'group') {
    return index.groupIntervalById.get(item.id) ?? null;
  }

  const deviceIndex = index.deviceIds.indexOf(item.id);
  return deviceIndex < 0
    ? null
    : { firstDeviceIndex: deviceIndex, lastDeviceIndex: deviceIndex };
};

const haveSameItem = (
  left: RackSelectionItem | null,
  right: RackSelectionItem | null,
): boolean => left === right || (
  left !== null
  && right !== null
  && left.kind === right.kind
  && left.id === right.id
);

interface RackSelectionState {
  selectedDeviceIds: string[];
  selectedGroupIds: string[];
  selectionAnchorItem: RackSelectionItem | null;
  navigationCursorItem: RackSelectionItem | null;
  rangeAnchorDeviceId: string | null;
}

export class RackSelection {
  public readonly state: RackSelectionState = $state({
    selectedDeviceIds: [],
    selectedGroupIds: [],
    selectionAnchorItem: null,
    navigationCursorItem: null,
    rangeAnchorDeviceId: null,
  });

  getOrderedSelectedDeviceIds(orderedIds: readonly string[]): string[] {
    return getOrderedSelectedIds(this.state.selectedDeviceIds, orderedIds);
  }

  getSelectedGroupContexts(devices: readonly GeneratorDeviceNode[]): GroupSelectionContext[] {
    const index = buildRackSelectionIndex(devices);
    return this.state.selectedGroupIds.flatMap((groupId) => {
      const memberDeviceIds = index.groupMemberIdsById.get(groupId);
      return memberDeviceIds ? [{ groupId, memberDeviceIds: [...memberDeviceIds] }] : [];
    });
  }

  clear(): void {
    this.commitSelection([], [], null, null, null);
  }

  toggleSelectedGroupId(groupId: string, orderedGroupIds: readonly string[]): void {
    if (!orderedGroupIds.includes(groupId)) {
      return;
    }

    const selectedGroupIds = [...this.state.selectedGroupIds];
    const selectedIndex = selectedGroupIds.indexOf(groupId);
    if (selectedIndex >= 0) {
      selectedGroupIds.splice(selectedIndex, 1);
    } else {
      selectedGroupIds.push(groupId);
    }

    const fallbackItem = selectedGroupIds.length > 0
      ? { kind: 'group' as const, id: selectedGroupIds.at(-1) as string }
      : this.state.selectedDeviceIds.length > 0
        ? { kind: 'device' as const, id: this.state.selectedDeviceIds.at(-1) as string }
        : null;
    const anchor = selectedIndex < 0
      ? { kind: 'group' as const, id: groupId }
      : fallbackItem;
    this.commitSelection(
      this.state.selectedDeviceIds,
      selectedGroupIds,
      anchor,
      anchor,
      anchor?.kind === 'device' ? anchor.id : null,
    );
  }

  toggleDeviceSelection(deviceId: string, orderedDeviceIds: readonly string[]): void {
    const next = toggleOrderedSelection(
      {
        selectedIds: this.state.selectedDeviceIds,
        anchorId: this.state.selectionAnchorItem?.kind === 'device'
          ? this.state.selectionAnchorItem.id
          : null,
      },
      deviceId,
      orderedDeviceIds,
    );
    const anchor = next.anchorId ? { kind: 'device' as const, id: next.anchorId } : null;
    this.commitSelection(
      next.selectedIds,
      this.state.selectedGroupIds,
      anchor,
      anchor,
      next.anchorId,
    );
  }

  selectSingleDevice(deviceId: string, orderedDeviceIds: readonly string[]): void {
    const next = selectSingleOrderedItem(
      { selectedIds: [], anchorId: null },
      deviceId,
      orderedDeviceIds,
    );
    const item = next.anchorId ? { kind: 'device' as const, id: next.anchorId } : null;
    this.commitSelection(next.selectedIds, [], item, item, next.anchorId);
  }

  selectSingleItem(item: RackSelectionItem, devices: readonly GeneratorDeviceNode[]): void {
    const index = buildRackSelectionIndex(devices);
    if (!resolveItemInterval(item, index)) {
      return;
    }

    this.commitSelection(
      item.kind === 'device' ? [item.id] : [],
      item.kind === 'group' ? [item.id] : [],
      item,
      item,
      item.kind === 'device' ? item.id : null,
    );
  }

  selectAll(devices: readonly GeneratorDeviceNode[]): void {
    const index = buildRackSelectionIndex(devices);
    const selectedDeviceIds = index.topLevelItems.flatMap((item) =>
      item.kind === 'device' ? [item.id] : []);
    const selectedGroupIds = index.topLevelItems.flatMap((item) =>
      item.kind === 'group' ? [item.id] : []);
    const anchor = index.topLevelItems.at(-1) ?? null;
    this.commitSelection(
      selectedDeviceIds,
      selectedGroupIds,
      anchor,
      anchor,
      anchor?.kind === 'device' ? anchor.id : null,
    );
  }

  setSelectedRackItems(
    deviceIds: readonly string[],
    groupIds: readonly string[],
    anchor: RackSelectionItem | null,
    devices: readonly GeneratorDeviceNode[],
  ): void {
    const index = buildRackSelectionIndex(devices);
    const validDeviceIds = new SvelteSet(index.deviceIds);
    const validGroupIds = new SvelteSet(index.groupIds);
    const resolvedAnchor = anchor && resolveItemInterval(anchor, index) ? anchor : null;
    this.commitSelection(
      deviceIds.filter((id) => validDeviceIds.has(id)),
      groupIds.filter((id) => validGroupIds.has(id)),
      resolvedAnchor,
      resolvedAnchor,
      resolvedAnchor?.kind === 'device' ? resolvedAnchor.id : null,
    );
  }

  selectRange(
    target: RackSelectionItem,
    devices: readonly GeneratorDeviceNode[],
    options: {
      additive?: boolean;
      direction?: -1 | 1;
      promoteGroups?: boolean;
    } = {},
  ): void {
    const index = buildRackSelectionIndex(devices);
    const targetInterval = resolveItemInterval(target, index);
    const anchor = this.state.selectionAnchorItem;
    const anchorInterval = anchor ? resolveItemInterval(anchor, index) : null;
    if (!targetInterval) {
      return;
    }
    if (!anchor || !anchorInterval) {
      this.selectSingleItem(target, devices);
      return;
    }

    const direction = options.direction
      ?? (targetInterval.lastDeviceIndex < anchorInterval.firstDeviceIndex ? -1 : 1);
    const storedAnchorIndex = this.state.rangeAnchorDeviceId
      ? index.deviceIds.indexOf(this.state.rangeAnchorDeviceId)
      : -1;
    const anchorDeviceIndex = storedAnchorIndex >= 0
      ? storedAnchorIndex
      : direction > 0
        ? anchorInterval.firstDeviceIndex
        : anchorInterval.lastDeviceIndex;
    const targetDeviceIndex = direction > 0
      ? targetInterval.lastDeviceIndex
      : targetInterval.firstDeviceIndex;
    const selectedDeviceIds = options.additive
      ? this.expandSelectedDeviceIds(index)
      : [];
    const rangeStart = Math.min(anchorDeviceIndex, targetDeviceIndex);
    const rangeEnd = Math.max(anchorDeviceIndex, targetDeviceIndex);
    selectedDeviceIds.push(...index.deviceIds.slice(rangeStart, rangeEnd + 1));

    const compacted = this.compactSelectedDeviceIds(
      selectedDeviceIds,
      index,
      options.promoteGroups !== false,
    );
    this.commitSelection(
      compacted.deviceIds,
      compacted.groupIds,
      anchor,
      target,
      index.deviceIds[anchorDeviceIndex] ?? null,
    );
  }

  selectDeviceRange(
    deviceId: string,
    additive: boolean,
    devices: readonly GeneratorDeviceNode[],
    direction?: -1 | 1,
  ): void {
    const index = buildRackSelectionIndex(devices);
    const anchor = this.state.selectionAnchorItem;
    const anchorGroupId = anchor?.kind === 'device'
      ? index.groupIdByDeviceId.get(anchor.id) ?? null
      : null;
    const targetGroupId = index.groupIdByDeviceId.get(deviceId) ?? null;
    this.selectRange(
      { kind: 'device', id: deviceId },
      devices,
      {
        additive,
        direction,
        promoteGroups: !anchorGroupId || anchorGroupId !== targetGroupId,
      },
    );
  }

  reconcileWithDevices(devices: readonly GeneratorDeviceNode[]): void {
    const index = buildRackSelectionIndex(devices);
    const selectedDeviceIds = reconcileOrderedSelection(
      { selectedIds: this.state.selectedDeviceIds, anchorId: null },
      index.deviceIds,
    ).selectedIds;
    const validGroupIds = new SvelteSet(index.groupIds);
    const selectedGroupIds = this.state.selectedGroupIds.filter((id) => validGroupIds.has(id));
    const anchor = this.reconcileItem(this.state.selectionAnchorItem, index);
    const cursor = this.reconcileItem(this.state.navigationCursorItem, index);
    const rangeAnchorDeviceId = this.state.rangeAnchorDeviceId
      && index.deviceIds.includes(this.state.rangeAnchorDeviceId)
      ? this.state.rangeAnchorDeviceId
      : null;
    this.commitSelection(
      selectedDeviceIds,
      selectedGroupIds,
      anchor,
      cursor,
      rangeAnchorDeviceId,
    );
  }

  applyNextSelectionAfterDelete(
    deletedIds: readonly string[],
    orderedDeviceIds: readonly string[],
  ): void {
    const deletedIdSet = new SvelteSet(deletedIds);
    const deletedIndexes = deletedIds
      .map((id) => orderedDeviceIds.indexOf(id))
      .filter((index) => index >= 0);
    if (deletedIndexes.length === 0) {
      this.clear();
      return;
    }

    const highestIndex = Math.max(...deletedIndexes);
    const lowestIndex = Math.min(...deletedIndexes);
    const nextId = orderedDeviceIds
      .slice(highestIndex + 1)
      .find((id) => !deletedIdSet.has(id));
    const previousId = orderedDeviceIds
      .slice(0, lowestIndex)
      .reverse()
      .find((id) => !deletedIdSet.has(id));
    const targetId = nextId ?? previousId;
    if (targetId) {
      this.selectSingleDevice(targetId, orderedDeviceIds);
    } else {
      this.clear();
    }
  }

  private expandSelectedDeviceIds(index: RackSelectionIndex): string[] {
    const selectedIds = new SvelteSet(this.state.selectedDeviceIds);
    for (const groupId of this.state.selectedGroupIds) {
      for (const deviceId of index.groupMemberIdsById.get(groupId) ?? []) {
        selectedIds.add(deviceId);
      }
    }
    return index.deviceIds.filter((id) => selectedIds.has(id));
  }

  private compactSelectedDeviceIds(
    deviceIds: readonly string[],
    index: RackSelectionIndex,
    promoteGroups: boolean,
  ): { deviceIds: string[]; groupIds: string[] } {
    const selectedIds = new SvelteSet(deviceIds);
    const groupIds = promoteGroups
      ? index.groupIds.filter((groupId) =>
          index.groupMemberIdsById.get(groupId)?.every((id) => selectedIds.has(id)) === true)
      : [];
    const promotedGroupIds = new SvelteSet(groupIds);
    return {
      deviceIds: index.deviceIds.filter((deviceId) => {
        const groupId = index.groupIdByDeviceId.get(deviceId);
        return selectedIds.has(deviceId) && (!groupId || !promotedGroupIds.has(groupId));
      }),
      groupIds,
    };
  }

  private reconcileItem(
    item: RackSelectionItem | null,
    index: RackSelectionIndex,
  ): RackSelectionItem | null {
    return item && resolveItemInterval(item, index) ? item : null;
  }

  private commitSelection(
    selectedDeviceIds: string[],
    selectedGroupIds: string[],
    anchor: RackSelectionItem | null,
    cursor: RackSelectionItem | null,
    rangeAnchorDeviceId: string | null,
  ): void {
    if (!haveSameSelectedIds(selectedDeviceIds, this.state.selectedDeviceIds)) {
      this.state.selectedDeviceIds = selectedDeviceIds;
    }
    if (!haveSameSelectedIds(selectedGroupIds, this.state.selectedGroupIds)) {
      this.state.selectedGroupIds = selectedGroupIds;
    }
    if (!haveSameItem(anchor, this.state.selectionAnchorItem)) {
      this.state.selectionAnchorItem = anchor;
    }
    if (!haveSameItem(cursor, this.state.navigationCursorItem)) {
      this.state.navigationCursorItem = cursor;
    }
    if (rangeAnchorDeviceId !== this.state.rangeAnchorDeviceId) {
      this.state.rangeAnchorDeviceId = rangeAnchorDeviceId;
    }
  }
}

export const createRackSelection = (): RackSelection => new RackSelection();
