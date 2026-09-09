import type { GeneratorDeviceNode } from '../../../shared/model';
import type { BrowserInsertSource } from './types';
import type { GroupSelectionContext, RackSelectionItem } from './selection.svelte';
import type { RackSelection } from './selection.svelte';

export interface RackViewApi {
  syncAfterRender(): void;
  applyNextSelectionAfterDelete(deletedIds: readonly string[]): void;
  getOrderedSelectedDeviceIds(): string[];
  selectAllRackItems(): void;
  setSelectedDeviceIds(deviceIds: readonly string[]): void;
  setSelectedGroupIds(groupIds: readonly string[]): void;
  setSelectedRackItems(
    deviceIds: readonly string[],
    groupIds: readonly string[],
    anchor: RackSelectionItem | null,
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
  selectAllRackItems: () => {
    options.rackSelection.selectAll(options.getDevices());
  },
  setSelectedDeviceIds: (deviceIds) => {
    const anchorId = deviceIds.at(-1) ?? null;
    options.rackSelection.setSelectedRackItems(
      deviceIds,
      [],
      anchorId ? { kind: 'device', id: anchorId } : null,
      options.getDevices(),
    );
  },
  setSelectedGroupIds: (groupIds) => {
    const anchorId = groupIds.at(-1) ?? null;
    options.rackSelection.setSelectedRackItems(
      [],
      groupIds,
      anchorId ? { kind: 'group', id: anchorId } : null,
      options.getDevices(),
    );
  },
  setSelectedRackItems: (deviceIds, groupIds, anchor) => {
    options.rackSelection.setSelectedRackItems(
      deviceIds,
      groupIds,
      anchor,
      options.getDevices(),
    );
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
