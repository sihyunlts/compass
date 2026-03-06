import { normalizeOptionalId } from '../../../shared/normalize-id';
import type { GeneratorDeviceNode } from '../../../shared/model';

/** Selected group metadata used by group-level actions. */
export interface GroupSelectionContext {
  groupId: string;
  memberDeviceIds: string[];
}

const buildSelectionRange = (
  orderedIds: readonly string[],
  fromId: string,
  toId: string,
): string[] => {
  const fromIndex = orderedIds.indexOf(fromId);
  const toIndex = orderedIds.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) {
    return [toId];
  }

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return orderedIds.slice(start, end + 1);
};

const resolveOrderedGroupIds = (devices: readonly GeneratorDeviceNode[]): string[] => {
  const groupIds: string[] = [];

  for (const device of devices) {
    const groupId = normalizeOptionalId(device.groupId);
    if (!groupId || groupIds.includes(groupId)) {
      continue;
    }

    groupIds.push(groupId);
  }

  return groupIds;
};

const resolveGroupMemberIds = (
  devices: readonly GeneratorDeviceNode[],
  groupId: string,
): string[] => devices
  .filter((device) => normalizeOptionalId(device.groupId) === groupId)
  .map((device) => device.id);

const dedupeIds = (ids: Iterable<string>): string[] => {
  const nextIds: string[] = [];

  for (const id of ids) {
    if (nextIds.includes(id)) {
      continue;
    }
    nextIds.push(id);
  }

  return nextIds;
};

interface RackSelectionState {
  selectedDeviceIds: string[];
  lastSelectedDeviceId: string | null;
  selectedGroupIds: string[];
  lastSelectedGroupId: string | null;
}

export class RackSelection {
  public readonly state: RackSelectionState = $state({
    selectedDeviceIds: [],
    lastSelectedDeviceId: null,
    selectedGroupIds: [],
    lastSelectedGroupId: null,
  });

  getOrderedSelectedDeviceIds(orderedIds: readonly string[]): string[] {
    return orderedIds.filter((id) => this.state.selectedDeviceIds.includes(id));
  }

  getSelectedGroupIds(): string[] {
    return [...this.state.selectedGroupIds];
  }

  getSelectedGroupContexts(devices: readonly GeneratorDeviceNode[]): GroupSelectionContext[] {
    const contexts: GroupSelectionContext[] = [];

    for (const groupId of this.state.selectedGroupIds) {
      const memberDeviceIds = resolveGroupMemberIds(devices, groupId);
      if (memberDeviceIds.length === 0) {
        continue;
      }
      contexts.push({ groupId, memberDeviceIds });
    }

    return contexts;
  }

  clear(): void {
    this.state.selectedDeviceIds = [];
    this.state.lastSelectedDeviceId = null;
    this.state.selectedGroupIds = [];
    this.state.lastSelectedGroupId = null;
  }

  selectDeviceIds(
    ids: Iterable<string>,
    anchorId: string | null,
    orderedDeviceIds: readonly string[],
  ): void {
    this.state.selectedDeviceIds = dedupeIds(ids)
      .filter((id) => orderedDeviceIds.includes(id));

    if (anchorId && orderedDeviceIds.includes(anchorId)) {
      this.state.lastSelectedDeviceId = anchorId;
    } else if (this.state.selectedDeviceIds.length === 0) {
      this.state.lastSelectedDeviceId = null;
    }
  }

  setSelectedGroupIds(
    ids: Iterable<string>,
    orderedGroupIds: readonly string[],
  ): void {
    const nextSelection = dedupeIds(ids).filter((id) => orderedGroupIds.includes(id));

    this.state.selectedGroupIds = nextSelection;
    if (
      this.state.lastSelectedGroupId
      && nextSelection.includes(this.state.lastSelectedGroupId)
    ) {
      return;
    }

    this.state.lastSelectedGroupId = nextSelection.at(-1) ?? null;
  }

  toggleSelectedGroupId(groupId: string, orderedGroupIds: readonly string[]): void {
    if (!orderedGroupIds.includes(groupId)) {
      return;
    }

    const nextSelection = [...this.state.selectedGroupIds];
    const existingIndex = nextSelection.indexOf(groupId);
    if (existingIndex >= 0) {
      nextSelection.splice(existingIndex, 1);
      if (this.state.lastSelectedGroupId === groupId) {
        this.state.lastSelectedGroupId = nextSelection.at(-1) ?? null;
      }
    } else {
      nextSelection.push(groupId);
      this.state.lastSelectedGroupId = groupId;
    }

    this.state.selectedGroupIds = nextSelection;
  }

  reconcileWithDevices(devices: readonly GeneratorDeviceNode[]): void {
    const validDeviceIds = devices.map((device) => device.id);
    const nextSelectedDeviceIds = this.state.selectedDeviceIds
      .filter((id) => validDeviceIds.includes(id));
    if (nextSelectedDeviceIds.length !== this.state.selectedDeviceIds.length) {
      this.state.selectedDeviceIds = nextSelectedDeviceIds;
    }

    if (
      this.state.lastSelectedDeviceId
      && !validDeviceIds.includes(this.state.lastSelectedDeviceId)
    ) {
      this.state.lastSelectedDeviceId = null;
    }

    const validGroupIds = resolveOrderedGroupIds(devices);
    const nextSelectedGroupIds = this.state.selectedGroupIds
      .filter((id) => validGroupIds.includes(id));
    if (nextSelectedGroupIds.length !== this.state.selectedGroupIds.length) {
      this.state.selectedGroupIds = nextSelectedGroupIds;
    }

    if (
      this.state.lastSelectedGroupId
      && !nextSelectedGroupIds.includes(this.state.lastSelectedGroupId)
    ) {
      this.state.lastSelectedGroupId = null;
    }
  }

  applyRangeSelection(
    deviceId: string,
    additiveSelection: boolean,
    orderedDeviceIds: readonly string[],
  ): void {
    const anchorId =
      this.state.lastSelectedDeviceId
      && orderedDeviceIds.includes(this.state.lastSelectedDeviceId)
        ? this.state.lastSelectedDeviceId
        : deviceId;
    const rangeIds = buildSelectionRange(orderedDeviceIds, anchorId, deviceId);

    if (additiveSelection) {
      this.selectDeviceIds(
        [...this.getOrderedSelectedDeviceIds(orderedDeviceIds), ...rangeIds],
        anchorId,
        orderedDeviceIds,
      );
      return;
    }

    this.clear();
    this.selectDeviceIds(rangeIds, anchorId, orderedDeviceIds);
  }

  toggleDeviceSelection(deviceId: string, orderedDeviceIds: readonly string[]): void {
    const nextSelection = this.getOrderedSelectedDeviceIds(orderedDeviceIds);
    const selectedIndex = nextSelection.indexOf(deviceId);
    if (selectedIndex >= 0) {
      nextSelection.splice(selectedIndex, 1);
    } else {
      nextSelection.push(deviceId);
    }

    this.selectDeviceIds(nextSelection, deviceId, orderedDeviceIds);
  }

  selectSingleDevice(deviceId: string, orderedDeviceIds: readonly string[]): void {
    this.clear();
    this.selectDeviceIds([deviceId], deviceId, orderedDeviceIds);
  }

  applyNextSelectionAfterDelete(
    deletedIds: readonly string[],
    orderedDeviceIds: readonly string[],
  ): void {
    let highestDeletedIndex = -1;
    let lowestDeletedIndex = orderedDeviceIds.length;

    for (const id of deletedIds) {
      const index = orderedDeviceIds.indexOf(id);
      if (index > highestDeletedIndex) {
        highestDeletedIndex = index;
      }
      if (index !== -1 && index < lowestDeletedIndex) {
        lowestDeletedIndex = index;
      }
    }

    if (highestDeletedIndex === -1) {
      this.clear();
      return;
    }

    for (let index = highestDeletedIndex + 1; index < orderedDeviceIds.length; index += 1) {
      const candidateId = orderedDeviceIds[index];
      if (!deletedIds.includes(candidateId)) {
        this.selectSingleDevice(candidateId, orderedDeviceIds);
        return;
      }
    }

    for (let index = lowestDeletedIndex - 1; index >= 0; index -= 1) {
      const candidateId = orderedDeviceIds[index];
      if (!deletedIds.includes(candidateId)) {
        this.selectSingleDevice(candidateId, orderedDeviceIds);
        return;
      }
    }

    this.clear();
  }
}

export const createRackSelection = (): RackSelection => new RackSelection();
