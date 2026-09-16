import { tick } from 'svelte';

import type { GeneratorChain, GeneratorDeviceNode } from '../../../shared/model';
import type { ContextMenuTarget } from '../context-menu/types';
import type {
  BrowserPresetInsertSource,
  BrowserNonRackPresetInsertSource,
  RackInteractionCommit,
  RackOutputPreviewMode,
  RackPresetFileDrop,
  RackScrollMetrics,
} from './types';
import { canCreateGroupFromSelection } from '../editor/chain-ops';
import type { ChainMutationMeta } from '../editor/history-core';
import { blurIfTextEditingElement } from './text-editing';
import {
  buildRackNavigationItems,
  createRackSelection,
  type RackSelectionItem,
} from './selection.svelte';
import type { RackDropZone } from './drop-ops';
import { createExternalFileDropController } from './external-file-drop-controller';
import { createRackRenameController } from './rename-controller.svelte';
import { createRackSurfaceController } from './surface-controller.svelte';
import { hasAdditiveSelectionModifier } from '../selection/ordered-selection';

interface DeviceRackControllerOptions {
  getDevices: () => GeneratorDeviceNode[];
  getChainState: () => GeneratorChain;
  getCollapsedSet: () => ReadonlySet<string>;
  getOrderedDeviceIds: () => readonly string[];
  getOrderedGroupIds: () => readonly string[];
  getGroupMemberIds: (groupId: string) => string[];
  getDeviceDisplayNameById: () => Record<string, string>;
  getGroupDisplayNameById: () => Record<string, string>;
  getInteractiveElementSelector: () => string;
  getChainDevices: () => HTMLElement | null;
  resolveMiniMapLayoutSignature: () => string;
  openContextMenu: (clientX: number, clientY: number, target: ContextMenuTarget) => void;
  closeContextMenu: () => void;
  commitOutputChain: (
    chain: GeneratorChain,
    meta: ChainMutationMeta,
    previewMode?: RackOutputPreviewMode,
  ) => void;
  requestTransientPreview: (delayMs?: number) => void;
  commitRackInteraction: (commit: RackInteractionCommit) => void;
  commitPresetInsertDrop: (
    source: BrowserNonRackPresetInsertSource,
    dropZone: RackDropZone,
  ) => void;
  commitRackPresetDrop: (source: Extract<BrowserPresetInsertSource, { kind: 'rack-preset' }>) => void;
  onScrollMetricsChange: (metrics: RackScrollMetrics) => void;
  onMiniMapContentRevisionChange: (revision: number) => void;
  getFilePath: (file: File) => string | null;
  onPresetFileDrop: (payload: RackPresetFileDrop) => void | Promise<void>;
  saveDevicePreset: (deviceId: string) => void;
  saveGroupPreset: (groupId: string) => void;
  toggleGroupEnabled: (groupId: string, nextEnabled: boolean) => void;
  toggleGroupIsolated: (groupId: string, nextIsolated: boolean) => void;
  toggleCollapse: (id: string) => void;
  renameDevice: (deviceId: string, rawName: string) => boolean;
  renameGroup: (groupId: string, rawName: string) => boolean;
}

/** Coordinates DeviceRack selection, context-menu, header interactions, and subcontrollers. */
class DeviceRackController {
  public readonly rackSelection = createRackSelection();

  public readonly rename: ReturnType<typeof createRackRenameController>;

  public readonly surface: ReturnType<typeof createRackSurfaceController>;

  public readonly externalFileDrop: ReturnType<typeof createExternalFileDropController>;

  public constructor(private readonly options: DeviceRackControllerOptions) {
    this.rename = createRackRenameController({
      getChainDevices: () => this.options.getChainDevices(),
      getDevices: () => this.options.getDevices(),
      getGroupStateById: () => this.options.getChainState().groupStateById,
      getOrderedGroupIds: () => this.options.getOrderedGroupIds(),
      getCollapsedSet: () => this.options.getCollapsedSet(),
      getDeviceDisplayNameById: () => this.options.getDeviceDisplayNameById(),
      getGroupDisplayNameById: () => this.options.getGroupDisplayNameById(),
      closeContextMenu: () => this.options.closeContextMenu(),
      renameDevice: (deviceId, rawName) => this.options.renameDevice(deviceId, rawName),
      renameGroup: (groupId, rawName) => this.options.renameGroup(groupId, rawName),
    });

    this.surface = createRackSurfaceController({
      rackSelection: this.rackSelection,
      getDevices: () => this.options.getDevices(),
      getChainState: () => this.options.getChainState(),
      getOrderedDeviceIds: () => this.options.getOrderedDeviceIds(),
      getInteractiveElementSelector: () => this.options.getInteractiveElementSelector(),
      resolveMiniMapLayoutSignature: () => this.options.resolveMiniMapLayoutSignature(),
      closeContextMenu: () => this.options.closeContextMenu(),
      commitOutputChain: (chain, meta, previewMode) =>
        this.options.commitOutputChain(chain, meta, previewMode),
      requestTransientPreview: (delayMs) => this.options.requestTransientPreview(delayMs),
      commitRackInteraction: (commit) => this.options.commitRackInteraction(commit),
      commitPresetInsertDrop: (source, dropZone) =>
        this.options.commitPresetInsertDrop(source, dropZone),
      commitRackPresetDrop: (source) => this.options.commitRackPresetDrop(source),
      onScrollMetricsChange: (metrics) => this.options.onScrollMetricsChange(metrics),
      onMiniMapContentRevisionChange: (revision) =>
        this.options.onMiniMapContentRevisionChange(revision),
      focusSelectedItem: () => this.focusSelectedItem(),
      startRenamingDevice: (deviceId) => this.rename.startRenamingDevice(deviceId),
      startRenamingGroup: (groupId) => this.rename.startRenamingGroup(groupId),
    });

    this.externalFileDrop = createExternalFileDropController({
      closeContextMenu: () => this.options.closeContextMenu(),
      clearDropIndicator: () => this.surface.clearDropIndicator(),
      syncDropIndicator: (clientX, clientY) =>
        this.surface.syncExternalFileDropIndicator(clientX, clientY),
      getFilePath: (file) => this.options.getFilePath(file),
      onPresetFileDrop: (payload) => this.options.onPresetFileDrop(payload),
    });
  }

  public get draggingDeviceIds(): string[] {
    return this.surface.activeDragInfo?.kind === 'chain' && this.surface.activeDragInfo.didMove
      ? this.surface.activeDragInfo.sourceIds
      : [];
  }

  public handleChainKeyDown(event: KeyboardEvent): void {
    void this.handleDeviceNavigationKeyDown(event);
    this.surface.handleChainKeyDown(event);
  }

  public handleChainScroll(): void {
    this.surface.handleChainScroll();
    this.rename.handleRackScroll();
  }

  public handleDeviceSavePreset(deviceId: string): void {
    this.consumeSuppressedDeviceSelectionClick();
    this.options.saveDevicePreset(deviceId);
  }

  public handleDeviceHeaderPointerDown(event: PointerEvent, deviceId: string): void {
    event.stopPropagation();
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }

    this.blurActiveTextEditingElement();
    const additiveSelection = hasAdditiveSelectionModifier(event);
    if (
      !event.shiftKey
      && !additiveSelection
      && !this.rackSelection.state.selectedDeviceIds.includes(deviceId)
    ) {
      this.options.closeContextMenu();
      this.rackSelection.selectSingleDevice(deviceId, this.options.getOrderedDeviceIds());
    }

    const orderedSelectedIds = this.getOrderedSelectedDeviceIdsInRack();
    const shouldDragSelection = orderedSelectedIds.includes(deviceId) && orderedSelectedIds.length > 1;
    const sourceIds = shouldDragSelection ? orderedSelectedIds : [deviceId];
    this.surface.startChainDrag(event, sourceIds, 'devices');
  }

  public handleDeviceHeaderClick(event: MouseEvent, deviceId: string): void {
    event.stopPropagation();

    if (this.consumeSuppressedDeviceSelectionClick()) {
      return;
    }

    this.options.closeContextMenu();
    const additiveSelection = hasAdditiveSelectionModifier(event);
    if (event.shiftKey) {
      this.rackSelection.selectDeviceRange(
        deviceId,
        additiveSelection,
        this.options.getDevices(),
      );
      void this.focusRackDeviceHeader(deviceId);
      return;
    }

    if (additiveSelection) {
      this.rackSelection.toggleDeviceSelection(deviceId, this.options.getOrderedDeviceIds());
      void this.focusRackDeviceHeader(deviceId);
      return;
    }

    this.rackSelection.selectSingleDevice(deviceId, this.options.getOrderedDeviceIds());
    void this.focusRackDeviceHeader(deviceId);
  }

  public handleDeviceHeaderContextMenu(event: MouseEvent, deviceId: string): void {
    event.stopPropagation();
    event.preventDefault();
    this.selectDeviceForContextMenu(deviceId);

    const deviceIds = this.getOrderedSelectedDeviceIdsInRack();
    this.options.openContextMenu(event.clientX, event.clientY, {
      kind: 'devices',
      deviceIds,
      canGroup: canCreateGroupFromSelection(this.options.getChainState().devices, deviceIds),
    });
  }

  public handleDeviceHeaderDoubleClick(event: MouseEvent, deviceId: string): void {
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }

    this.options.toggleCollapse(deviceId);
  }

  public handleGroupEnabledChange(event: Event, groupId: string): void {
    event.stopPropagation();
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    this.options.toggleGroupEnabled(groupId, target.checked);
  }

  public handleGroupTogglePointerDown(event: PointerEvent): void {
    event.stopPropagation();
  }

  public handleGroupToggleClick(event: MouseEvent): void {
    event.stopPropagation();
    this.consumeSuppressedDeviceSelectionClick();
  }

  public handleGroupSavePointerDown(event: PointerEvent): void {
    event.stopPropagation();
  }

  public handleGroupSaveClick(event: MouseEvent, groupId: string): void {
    event.stopPropagation();
    this.consumeSuppressedDeviceSelectionClick();
    this.options.saveGroupPreset(groupId);
  }

  public handleGroupSaveContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  public handleGroupIsolatePointerDown(event: PointerEvent): void {
    event.stopPropagation();
  }

  public handleGroupIsolateClick(
    event: MouseEvent,
    groupId: string,
    nextIsolated: boolean,
  ): void {
    event.stopPropagation();
    this.consumeSuppressedDeviceSelectionClick();
    this.options.toggleGroupIsolated(groupId, nextIsolated);
  }

  public handleGroupRailPointerDown(event: PointerEvent, groupId: string): void {
    event.stopPropagation();
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }

    this.blurActiveTextEditingElement();
    this.options.closeContextMenu();

    if (event.shiftKey) {
      this.rackSelection.selectRange(
        { kind: 'group', id: groupId },
        this.options.getDevices(),
      );
    } else if (hasAdditiveSelectionModifier(event)) {
      this.rackSelection.toggleSelectedGroupId(groupId, this.options.getOrderedGroupIds());
    } else {
      this.rackSelection.selectSingleItem(
        { kind: 'group', id: groupId },
        this.options.getDevices(),
      );
    }

    const sourceIds = this.options.getGroupMemberIds(groupId);
    if (sourceIds.length === 0) {
      return;
    }

    this.surface.startChainDrag(event, sourceIds, 'group');
  }

  public handleGroupRailClick(event: MouseEvent, groupId: string): void {
    event.stopPropagation();
    if (this.consumeSuppressedDeviceSelectionClick()) {
      return;
    }

    this.options.closeContextMenu();
    void this.focusRackGroupHeader(groupId);
  }

  public handleGroupRailContextMenu(event: MouseEvent, groupId: string): void {
    const memberDeviceIds = this.options.getGroupMemberIds(groupId);
    if (memberDeviceIds.length === 0) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    this.selectGroupForContextMenu(groupId);
    this.options.openContextMenu(event.clientX, event.clientY, {
      kind: 'group',
      groupId,
      memberDeviceIds,
    });
  }

  public handleGroupRailDoubleClick(event: MouseEvent, groupId: string): void {
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }

    const memberDeviceIds = this.options.getGroupMemberIds(groupId);
    if (memberDeviceIds.length === 0) {
      return;
    }

    const shouldCollapseGroup = memberDeviceIds.some(
      (deviceId) => !this.options.getCollapsedSet().has(deviceId),
    );
    for (const deviceId of memberDeviceIds) {
      if (this.options.getCollapsedSet().has(deviceId) === shouldCollapseGroup) {
        continue;
      }

      this.options.toggleCollapse(deviceId);
    }
  }

  private getOrderedSelectedDeviceIdsInRack(): string[] {
    return this.rackSelection.getOrderedSelectedDeviceIds(this.options.getOrderedDeviceIds());
  }

  private resolveRackDeviceHeader(deviceId: string): HTMLElement | null {
    return this.options.getChainDevices()?.querySelector<HTMLElement>(
      `.device-card[data-device-id="${deviceId}"] [data-rack-device-header="true"]`,
    ) ?? null;
  }

  private async focusRackDeviceHeader(deviceId: string): Promise<void> {
    await tick();
    const headerEl = this.resolveRackDeviceHeader(deviceId);
    if (!headerEl) {
      return;
    }

    headerEl.focus();
    headerEl.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }

  private resolveRackGroupHeader(groupId: string): HTMLElement | null {
    return this.options.getChainDevices()?.querySelector<HTMLElement>(
      `.device-group[data-group-id="${CSS.escape(groupId)}"] [data-rack-group-header="true"]`,
    ) ?? null;
  }

  private async focusRackGroupHeader(groupId: string): Promise<void> {
    await tick();
    const headerEl = this.resolveRackGroupHeader(groupId);
    if (!headerEl) {
      return;
    }

    headerEl.focus();
    headerEl.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }

  private focusSelectedItem(): void {
    const selectedItem = this.rackSelection.state.navigationCursorItem;
    if (selectedItem) {
      void this.focusRackItem(selectedItem);
    }
  }

  private async focusRackItem(item: RackSelectionItem): Promise<void> {
    if (item.kind === 'group') {
      await this.focusRackGroupHeader(item.id);
      return;
    }
    await this.focusRackDeviceHeader(item.id);
  }

  private blurActiveTextEditingElement(): void {
    blurIfTextEditingElement(document.activeElement);
  }

  private consumeSuppressedDeviceSelectionClick(): boolean {
    return this.surface.consumeSuppressedSelectionClick();
  }

  private selectDeviceForContextMenu(deviceId: string): void {
    if (this.rackSelection.state.selectedDeviceIds.includes(deviceId)) {
      return;
    }

    this.rackSelection.selectSingleDevice(deviceId, this.options.getOrderedDeviceIds());
  }

  private selectGroupForContextMenu(groupId: string): void {
    if (this.rackSelection.state.selectedGroupIds.includes(groupId)) {
      return;
    }

    this.rackSelection.selectSingleItem(
      { kind: 'group', id: groupId },
      this.options.getDevices(),
    );
  }

  private resolveKeyboardSelectionTarget(): RackSelectionItem | null {
    const navigationItems = buildRackNavigationItems(this.options.getDevices());
    if (navigationItems.length === 0) {
      return null;
    }

    const selectionCursor = this.rackSelection.state.navigationCursorItem;
    if (selectionCursor) {
      return selectionCursor;
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      const activeGroup = activeElement.closest<HTMLElement>('.device-group[data-group-id]');
      if (activeElement.matches('[data-rack-group-header="true"]')) {
        const activeGroupId = activeGroup?.dataset.groupId;
        if (activeGroupId) {
          return { kind: 'group', id: activeGroupId };
        }
      }

      const activeCard = activeElement.closest<HTMLElement>('.device-card[data-device-id]');
      const activeDeviceId = activeCard?.dataset.deviceId;
      if (activeDeviceId) {
        return { kind: 'device', id: activeDeviceId };
      }
    }

    return navigationItems[0] ?? null;
  }

  private shouldHandleDeviceNavigationKey(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) {
      return false;
    }

    if (
      event.key !== 'ArrowLeft'
      && event.key !== 'ArrowRight'
      && event.key !== 'Home'
      && event.key !== 'End'
    ) {
      return false;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    if (target.closest(this.options.getInteractiveElementSelector()) || target.isContentEditable) {
      return false;
    }

    return true;
  }

  private async handleDeviceNavigationKeyDown(event: KeyboardEvent): Promise<boolean> {
    const devices = this.options.getDevices();
    if (!this.shouldHandleDeviceNavigationKey(event) || devices.length === 0) {
      return false;
    }

    const currentItem = this.resolveKeyboardSelectionTarget();
    const selectionAnchor = this.rackSelection.state.selectionAnchorItem;
    const navigationItems = event.shiftKey
      ? devices.map((device): RackSelectionItem => ({ kind: 'device', id: device.id }))
      : buildRackNavigationItems(devices);
    const navigationDirection = event.key === 'ArrowLeft' || event.key === 'Home' ? -1 : 1;
    const currentIndex = this.resolveNavigationItemIndex(
      currentItem,
      navigationItems,
      navigationDirection,
    );

    let nextIndex: number;
    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
        break;
      case 'ArrowRight':
        nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, navigationItems.length - 1);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = navigationItems.length - 1;
        break;
      default:
        return false;
    }

    const nextItem = navigationItems[nextIndex];
    if (!nextItem) {
      return false;
    }

    event.preventDefault();
    this.options.closeContextMenu();

    if (event.shiftKey && selectionAnchor?.kind === 'group') {
      this.rackSelection.selectRange(
        nextItem,
        devices,
        { direction: navigationDirection },
      );
    } else if (
      event.shiftKey
      && selectionAnchor?.kind === 'device'
      && nextItem.kind === 'device'
    ) {
      this.rackSelection.selectDeviceRange(
        nextItem.id,
        false,
        devices,
        navigationDirection,
      );
    } else {
      this.rackSelection.selectSingleItem(nextItem, devices);
    }

    await this.focusRackItem(nextItem);
    return true;
  }

  private resolveNavigationItemIndex(
    currentItem: RackSelectionItem | null,
    navigationItems: readonly RackSelectionItem[],
    direction: -1 | 1,
  ): number {
    if (!currentItem) {
      return -1;
    }

    const exactIndex = navigationItems.findIndex((item) =>
      item.kind === currentItem.kind && item.id === currentItem.id);
    if (exactIndex >= 0 || currentItem.kind === 'device') {
      return exactIndex;
    }

    const memberDeviceIds = this.options.getGroupMemberIds(currentItem.id);
    const edgeDeviceId = direction > 0
      ? memberDeviceIds.at(-1)
      : memberDeviceIds[0];
    if (!edgeDeviceId) {
      return -1;
    }

    return navigationItems.findIndex((item) =>
      item.kind === 'device' && item.id === edgeDeviceId);
  }
}

export const createDeviceRackController = (
  options: DeviceRackControllerOptions,
) => new DeviceRackController(options);
