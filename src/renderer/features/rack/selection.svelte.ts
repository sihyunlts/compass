import { normalizeOptionalId } from '../../../shared/normalize-id';
import type { GeneratorDeviceNode } from '../../../shared/model';
import {
  applyOrderedRangeSelection,
  getOrderedSelectedIds,
  haveSameSelectedIds,
  reconcileOrderedSelection,
  selectSingleOrderedItem,
  toggleOrderedSelection,
  updateOrderedSelection,
  type OrderedSelectionUpdate,
} from '../selection/ordered-selection';

/** Selected group metadata used by group-level actions. */
export interface GroupSelectionContext {
  groupId: string;
  memberDeviceIds: string[];
}

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
    return getOrderedSelectedIds(this.state.selectedDeviceIds, orderedIds);
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
    this.applyDeviceSelection(updateOrderedSelection(
      this.deviceSelectionSnapshot(),
      ids,
      anchorId,
      orderedDeviceIds,
    ));
  }

  setSelectedGroupIds(
    ids: Iterable<string>,
    orderedGroupIds: readonly string[],
  ): void {
    const nextSelection = updateOrderedSelection(
      {
        selectedIds: this.state.selectedGroupIds,
        anchorId: this.state.lastSelectedGroupId,
      },
      ids,
      null,
      orderedGroupIds,
    ).selectedIds;

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
    this.applyDeviceSelection(reconcileOrderedSelection(
      this.deviceSelectionSnapshot(),
      validDeviceIds,
    ));

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
    const currentSelection = this.deviceSelectionSnapshot();
    if (!additiveSelection) {
      this.clear();
    }
    this.applyDeviceSelection(applyOrderedRangeSelection(
      currentSelection,
      deviceId,
      additiveSelection,
      orderedDeviceIds,
    ));
  }

  toggleDeviceSelection(deviceId: string, orderedDeviceIds: readonly string[]): void {
    this.applyDeviceSelection(toggleOrderedSelection(
      this.deviceSelectionSnapshot(),
      deviceId,
      orderedDeviceIds,
    ));
  }

  selectSingleDevice(deviceId: string, orderedDeviceIds: readonly string[]): void {
    this.clear();
    this.applyDeviceSelection(selectSingleOrderedItem(
      this.deviceSelectionSnapshot(),
      deviceId,
      orderedDeviceIds,
    ));
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

  private deviceSelectionSnapshot() {
    return {
      selectedIds: this.state.selectedDeviceIds,
      anchorId: this.state.lastSelectedDeviceId,
    };
  }

  private applyDeviceSelection(update: OrderedSelectionUpdate): void {
    if (!haveSameSelectedIds(update.selectedIds, this.state.selectedDeviceIds)) {
      this.state.selectedDeviceIds = update.selectedIds;
    }

    if (update.anchorId !== this.state.lastSelectedDeviceId) {
      this.state.lastSelectedDeviceId = update.anchorId;
    }
  }
}

export const createRackSelection = (): RackSelection => new RackSelection();
