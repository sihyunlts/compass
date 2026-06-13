import type { GeneratorDeviceNode } from '../../../shared/model';
import type { BrowserInsertSource } from './types';
import type { GroupSelectionContext } from './selection.svelte';
import type { RackSelection } from './selection.svelte';

export interface RackViewApi {
  syncAfterRender(): void;
  applyNextSelectionAfterDelete(deletedIds: readonly string[]): void;
  getOrderedSelectedDeviceIds(): string[];
  selectAllDevices(deviceIds: readonly string[]): void;
  setSelectedDeviceIds(
    deviceIds: readonly string[],
    orderedDeviceIds?: readonly string[],
  ): void;
  setSelectedGroupIds(
    groupIds: readonly string[],
    orderedGroupIds?: readonly string[],
  ): void;
  getSelectedGroupContexts(): GroupSelectionContext[];
  clearSelection(): void;
  startRenamingDevice(deviceId: string): boolean;
  startRenamingGroup(groupId: string): boolean;
  hasPointerInteraction(): boolean;
  setScrollLeft(nextScrollLeft: number): void;
  handleBrowserPointerDown(
    sourceEvent: PointerEvent,
    source: BrowserInsertSource,
    itemEl: HTMLElement,
    badgeLabel: string,
  ): boolean;
}

interface CreateRackViewApiOptions {
  rackSelection: RackSelection;
  getDevices: () => readonly GeneratorDeviceNode[];
  getOrderedDeviceIds: () => readonly string[];
  getOrderedGroupIds: () => readonly string[];
  syncAfterRender: () => void;
  startRenamingDevice: (deviceId: string) => boolean;
  startRenamingGroup: (groupId: string) => boolean;
  hasPointerInteraction: () => boolean;
  setScrollLeft: (nextScrollLeft: number) => void;
  handleBrowserPointerDown: (
    sourceEvent: PointerEvent,
    source: BrowserInsertSource,
    itemEl: HTMLElement,
    badgeLabel: string,
  ) => boolean;
}

export const createRackViewApi = (
  options: CreateRackViewApiOptions,
): RackViewApi => ({
  syncAfterRender: options.syncAfterRender,
  applyNextSelectionAfterDelete: (deletedIds) => {
    options.rackSelection.applyNextSelectionAfterDelete(
      deletedIds,
      options.getOrderedDeviceIds(),
    );
  },
  getOrderedSelectedDeviceIds: () =>
    options.rackSelection.getOrderedSelectedDeviceIds(options.getOrderedDeviceIds()),
  selectAllDevices: (deviceIds) => {
    options.rackSelection.clear();
    if (deviceIds.length === 0) {
      return;
    }

    const anchorId = deviceIds[deviceIds.length - 1] ?? null;
    options.rackSelection.selectDeviceIds(
      deviceIds,
      anchorId,
      options.getOrderedDeviceIds(),
    );
  },
  setSelectedDeviceIds: (deviceIds, orderedDeviceIds = options.getOrderedDeviceIds()) => {
    const anchorId = deviceIds[deviceIds.length - 1] ?? null;
    options.rackSelection.selectDeviceIds(
      deviceIds,
      anchorId,
      orderedDeviceIds,
    );
  },
  setSelectedGroupIds: (groupIds, orderedGroupIds = options.getOrderedGroupIds()) => {
    options.rackSelection.clear();
    if (groupIds.length === 0) {
      return;
    }

    options.rackSelection.setSelectedGroupIds(groupIds, orderedGroupIds);
  },
  getSelectedGroupContexts: () =>
    options.rackSelection.getSelectedGroupContexts(options.getDevices()),
  clearSelection: () => {
    options.rackSelection.clear();
  },
  startRenamingDevice: options.startRenamingDevice,
  startRenamingGroup: options.startRenamingGroup,
  hasPointerInteraction: options.hasPointerInteraction,
  setScrollLeft: options.setScrollLeft,
  handleBrowserPointerDown: options.handleBrowserPointerDown,
});
