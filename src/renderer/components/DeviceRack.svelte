<script lang="ts">
  /**
   * Renders the rack surface and translates pointer/drag interactions into commit events.
   * Integrates rack selection, drop indicators, and group rendering state.
   */
  import { onMount, tick } from 'svelte';
  import type { GeneratorDeviceNode, GeneratorChain } from '../../shared/model';
  import type { ContextMenuTarget } from './context-menu-types';
  import type {
    BrowserPresetInsertSource,
    RackInteractionCommit,
    RackPresetFileDrop,
    RackScrollMetrics,
  } from './device-rack-types';
  import { canCreateGroupFromSelection } from '../features/editor/chain-ops';
  import type { ChainMutationMeta } from '../features/editor/history-core';
  import { blurIfTextEditingElement } from '../features/rack/text-editing';
  import { createRackSelection } from '../features/rack/selection.svelte';
  import {
    buildGroupColumns,
    buildGroupMemberIdsByGroupId,
    buildOrderedGroupIds,
    buildRackContentItems,
  } from '../features/rack/layout';
  import type { RackDropZone } from '../features/rack/drop-ops';
  import type { RackViewApi } from '../features/rack/api';
  import {
    buildDeviceDisplayNameById,
    buildGroupDisplayNameById,
  } from '../features/rack/display-names';
  import {
    resolveDeviceDisplayName,
    resolveGroupDisplayName,
  } from '../features/rack/rename';
  import { createExternalFileDropController } from '../features/rack/external-file-drop-controller';
  import { createRackRenameController } from '../features/rack/rename-controller.svelte';
  import { createRackSurfaceController } from '../features/rack/surface-controller.svelte';
  import RackRenamePopover from './RackRenamePopover.svelte';
  import DeviceCard from './DeviceCard.svelte';

  let {
    devices,
    chainState,
    collapsedDeviceIds = [] as string[],
    paletteRevision,
    currentBeat = 0,
    modulationReadoutById = {},
    resolvePaletteRgb,
    isSidebarResizing = false,
    interactiveElementSelector,
    onSaveChain,
    onScheduleAutoPreview,
    onOpenContextMenu,
    onCloseContextMenu,
    onCommit,
    onPresetInsertDrop = () => {},
    onScrollMetricsChange = () => {},
    onMiniMapContentRevisionChange = () => {},
    onPresetFileDrop = async () => {},
    onSaveDevicePreset = () => {},
    onSaveGroupPreset = () => {},
    onToggleGroupEnabled = () => {},
    onToggleCollapse = () => {},
    onRenameDevice = () => false,
    onRenameGroup = () => false,
    onRackApiReady = () => {},
  } = $props<{
    devices: GeneratorDeviceNode[];
    chainState: GeneratorChain;
    collapsedDeviceIds?: string[];
    paletteRevision: number;
    currentBeat?: number;
    modulationReadoutById?: Record<string, string>;
    resolvePaletteRgb: (velocity: number) => string;
    isSidebarResizing: boolean;
    interactiveElementSelector: string;
    onSaveChain: (chain: GeneratorChain, meta: ChainMutationMeta) => void;
    onScheduleAutoPreview: (delayMs?: number) => void;
    onOpenContextMenu: (clientX: number, clientY: number, target: ContextMenuTarget) => void;
    onCloseContextMenu: () => void;
    onCommit: (commit: RackInteractionCommit) => void;
    onPresetInsertDrop?: (
      source: BrowserPresetInsertSource,
      dropZone: RackDropZone,
    ) => void;
    onScrollMetricsChange?: (metrics: RackScrollMetrics) => void;
    onMiniMapContentRevisionChange?: (revision: number) => void;
    onPresetFileDrop?: (payload: RackPresetFileDrop) => void | Promise<void>;
    onSaveDevicePreset?: (deviceId: string) => void;
    onSaveGroupPreset?: (groupId: string) => void;
    onToggleGroupEnabled?: (groupId: string, nextEnabled: boolean) => void;
    onToggleCollapse: (id: string) => void;
    onRenameDevice?: (deviceId: string, rawName: string) => boolean;
    onRenameGroup?: (groupId: string, rawName: string) => boolean;
    onRackApiReady?: (api: RackViewApi | null) => void;
  }>();

  let chainDevicesEl = $state<HTMLElement | null>(null);
  let dropIndicatorEl = $state<HTMLElement | null>(null);
  let browserDragBadgeEl = $state<HTMLElement | null>(null);
  let renamePopover = $state<ReturnType<typeof RackRenamePopover> | null>(null);

  const rackSelection = createRackSelection();

  const resolveGroupEnabled = (groupId: string): boolean =>
    chainState.groupStateById[groupId]?.enabled !== false;

  const groupMemberIdsByGroupId = $derived.by(() => buildGroupMemberIdsByGroupId(devices));

  const getGroupMemberIds = (groupId: string): string[] =>
    groupMemberIdsByGroupId[groupId] ?? [];

  const orderedDeviceIds = $derived.by(() =>
    devices.map((device: GeneratorDeviceNode) => device.id));
  const orderedGroupIds = $derived.by(() => buildOrderedGroupIds(devices));
  const selectedDeviceIds = $derived.by(() => rackSelection.state.selectedDeviceIds);
  const selectedGroupIds = $derived.by(() => rackSelection.state.selectedGroupIds);
  const collapsedSet = $derived.by(() => new Set<string>(collapsedDeviceIds));
  const deviceDisplayNameById = $derived.by(() => buildDeviceDisplayNameById(devices));
  const groupDisplayNameById = $derived.by(() =>
    buildGroupDisplayNameById(devices, chainState.groupStateById));
  const rackContentItems = $derived.by(() =>
    buildRackContentItems(devices, resolveGroupEnabled));

  const miniMapLayoutSignature = $derived.by(() => {
    const rackOrderSignature = rackContentItems
      .map((item) =>
        item.kind === 'device'
          ? `d:${item.device.id}:${resolveDeviceDisplayName(deviceDisplayNameById, item.device.id)}`
          : `g:${item.groupId}:${resolveGroupDisplayName(groupDisplayNameById, item.groupId)}:${item.enabled ? '1' : '0'}:${item.devices.map((device) => device.id).join(',')}`)
      .join('|');
    const collapsedSignature = collapsedDeviceIds.join('|');
    return `${rackOrderSignature}::collapsed:${collapsedSignature}`;
  });

  const renameController = createRackRenameController({
    getChainDevices: () => chainDevicesEl,
    getDevices: () => devices,
    getGroupStateById: () => chainState.groupStateById,
    getOrderedGroupIds: () => orderedGroupIds,
    getCollapsedSet: () => collapsedSet,
    getDeviceDisplayNameById: () => deviceDisplayNameById,
    getGroupDisplayNameById: () => groupDisplayNameById,
    closeContextMenu: () => onCloseContextMenu(),
    renameDevice: (deviceId, rawName) => onRenameDevice(deviceId, rawName),
    renameGroup: (groupId, rawName) => onRenameGroup(groupId, rawName),
  });

  const rackSurface = createRackSurfaceController({
    rackSelection,
    getDevices: () => devices,
    getChainState: () => chainState,
    getOrderedDeviceIds: () => orderedDeviceIds,
    getOrderedGroupIds: () => orderedGroupIds,
    getInteractiveElementSelector: () => interactiveElementSelector,
    resolveMiniMapLayoutSignature: () => miniMapLayoutSignature,
    closeContextMenu: () => onCloseContextMenu(),
    saveChain: (chain, meta) => onSaveChain(chain, meta),
    scheduleAutoPreview: (delayMs) => onScheduleAutoPreview(delayMs),
    commitRackInteraction: (commit) => onCommit(commit),
    commitPresetInsertDrop: (source, dropZone) => onPresetInsertDrop(source, dropZone),
    onScrollMetricsChange: (metrics) => onScrollMetricsChange(metrics),
    onMiniMapContentRevisionChange: (revision) => onMiniMapContentRevisionChange(revision),
    startRenamingDevice: (deviceId) => renameController.startRenamingDevice(deviceId),
    startRenamingGroup: (groupId) => renameController.startRenamingGroup(groupId),
  });

  const externalFileDropController = createExternalFileDropController({
    closeContextMenu: () => onCloseContextMenu(),
    clearDropIndicator: () => rackSurface.clearDropIndicator(),
    syncDropIndicator: (clientX, clientY) =>
      rackSurface.syncExternalFileDropIndicator(clientX, clientY),
    onPresetFileDrop: (payload) => onPresetFileDrop(payload),
  });

  const draggingDeviceIds = $derived.by(() =>
    rackSurface.activeDragInfo?.kind === 'chain' && rackSurface.activeDragInfo.didMove
      ? rackSurface.activeDragInfo.sourceIds
      : []);

  const getOrderedSelectedDeviceIdsInRack = (): string[] =>
    rackSelection.getOrderedSelectedDeviceIds(orderedDeviceIds);

  const resolveRackDeviceHeader = (deviceId: string): HTMLElement | null =>
    chainDevicesEl?.querySelector<HTMLElement>(
      `.device-card[data-device-id="${deviceId}"] [data-rack-device-header="true"]`,
    ) ?? null;

  const isAdditiveSelection = (event: { metaKey: boolean; ctrlKey: boolean }): boolean =>
    event.metaKey || event.ctrlKey;

  const focusRackDeviceHeader = async (deviceId: string): Promise<void> => {
    await tick();
    const headerEl = resolveRackDeviceHeader(deviceId);
    if (!headerEl) {
      return;
    }

    headerEl.focus();
    headerEl.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  };

  const blurActiveTextEditingElement = (): void => {
    blurIfTextEditingElement(document.activeElement);
  };

  const consumeSuppressedDeviceSelectionClick = (): boolean =>
    rackSurface.consumeSuppressedSelectionClick();

  const handleDeviceSavePreset = (deviceId: string): void => {
    consumeSuppressedDeviceSelectionClick();
    onSaveDevicePreset(deviceId);
  };

  const selectDeviceForContextMenu = (deviceId: string): void => {
    if (selectedDeviceIds.includes(deviceId)) {
      return;
    }

    rackSelection.clear();
    rackSelection.selectDeviceIds([deviceId], deviceId, orderedDeviceIds);
  };

  const selectGroupForContextMenu = (groupId: string): void => {
    if (selectedGroupIds.includes(groupId)) {
      return;
    }

    rackSelection.clear();
    rackSelection.setSelectedGroupIds([groupId], orderedGroupIds);
  };

  function handleChainControlInputOrChange(event: Event) {
    rackSurface.handleChainControlInputOrChange(event);
  }

  function handleChainFocusIn(event: FocusEvent) {
    rackSurface.handleChainFocusIn(event);
  }

  const resolveKeyboardSelectionTargetId = (): string | null => {
    if (orderedDeviceIds.length === 0) {
      return null;
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) {
      const activeCard = activeElement.closest<HTMLElement>('.device-card[data-device-id]');
      const activeDeviceId = activeCard?.dataset.deviceId;
      if (activeDeviceId && orderedDeviceIds.includes(activeDeviceId)) {
        return activeDeviceId;
      }
    }

    const anchorId = rackSelection.state.lastSelectedDeviceId;
    if (anchorId && orderedDeviceIds.includes(anchorId)) {
      return anchorId;
    }

    return getOrderedSelectedDeviceIdsInRack().at(-1) ?? orderedDeviceIds[0] ?? null;
  };

  const shouldHandleDeviceNavigationKey = (event: KeyboardEvent): boolean => {
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

    if (target.closest(interactiveElementSelector) || target.isContentEditable) {
      return false;
    }

    return true;
  };

  const handleDeviceNavigationKeyDown = async (event: KeyboardEvent): Promise<boolean> => {
    if (!shouldHandleDeviceNavigationKey(event) || orderedDeviceIds.length === 0) {
      return false;
    }

    const currentDeviceId = resolveKeyboardSelectionTargetId();
    const currentIndex = currentDeviceId ? orderedDeviceIds.indexOf(currentDeviceId) : -1;

    let nextIndex: number;
    switch (event.key) {
      case 'ArrowLeft':
        nextIndex = currentIndex <= 0 ? 0 : currentIndex - 1;
        break;
      case 'ArrowRight':
        nextIndex = currentIndex < 0
          ? 0
          : Math.min(currentIndex + 1, orderedDeviceIds.length - 1);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = orderedDeviceIds.length - 1;
        break;
      default:
        return false;
    }

    const nextDeviceId = orderedDeviceIds[nextIndex];
    if (!nextDeviceId) {
      return false;
    }

    event.preventDefault();
    onCloseContextMenu();

    if (event.shiftKey && currentDeviceId) {
      rackSelection.applyRangeSelection(nextDeviceId, false, orderedDeviceIds);
    } else {
      rackSelection.selectSingleDevice(nextDeviceId, orderedDeviceIds);
    }

    await focusRackDeviceHeader(nextDeviceId);
    return true;
  };

  function handleChainKeyDown(event: KeyboardEvent) {
    void handleDeviceNavigationKeyDown(event);
    rackSurface.handleChainKeyDown(event);
  }

  function handleGroupEnabledChange(event: Event, groupId: string) {
    event.stopPropagation();
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    onToggleGroupEnabled(groupId, target.checked);
  }

  function handleGroupTogglePointerDown(event: PointerEvent) {
    event.stopPropagation();
  }

  function handleGroupToggleClick(event: MouseEvent) {
    event.stopPropagation();
    consumeSuppressedDeviceSelectionClick();
  }

  function handleGroupSavePointerDown(event: PointerEvent) {
    event.stopPropagation();
  }

  function handleGroupSaveClick(event: MouseEvent, groupId: string) {
    event.stopPropagation();
    consumeSuppressedDeviceSelectionClick();
    onSaveGroupPreset(groupId);
  }

  function handleGroupSaveContextMenu(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleGroupRailPointerDown(event: PointerEvent, groupId: string) {
    event.stopPropagation();
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }

    blurActiveTextEditingElement();
    onCloseContextMenu();

    if (isAdditiveSelection(event)) {
      rackSelection.toggleSelectedGroupId(groupId, orderedGroupIds);
    } else {
      rackSelection.clear();
      rackSelection.setSelectedGroupIds([groupId], orderedGroupIds);
    }

    const sourceIds = getGroupMemberIds(groupId);
    if (sourceIds.length === 0) {
      return;
    }

    if (rackSurface.startChainDrag(event, sourceIds, 'group')) {
      event.preventDefault();
    }
  }

  function handleGroupRailClick(event: MouseEvent) {
    event.stopPropagation();

    if (consumeSuppressedDeviceSelectionClick()) {
      return;
    }

    onCloseContextMenu();
  }

  function handleGroupRailContextMenu(event: MouseEvent, groupId: string) {
    const memberDeviceIds = getGroupMemberIds(groupId);
    if (memberDeviceIds.length === 0) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    selectGroupForContextMenu(groupId);
    onOpenContextMenu(event.clientX, event.clientY, {
      kind: 'group',
      groupId,
      memberDeviceIds,
    });
  }

  function handleGroupRailDoubleClick(event: MouseEvent, groupId: string) {
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }

    const memberDeviceIds = getGroupMemberIds(groupId);
    if (memberDeviceIds.length === 0) {
      return;
    }

    const shouldCollapseGroup = memberDeviceIds.some((deviceId) => !collapsedSet.has(deviceId));
    for (const deviceId of memberDeviceIds) {
      if (collapsedSet.has(deviceId) === shouldCollapseGroup) {
        continue;
      }

      onToggleCollapse(deviceId);
    }
  }

  function handleDeviceHeaderPointerDown(event: PointerEvent, deviceId: string) {
    event.stopPropagation();
    if (event.button !== 0 || !event.isPrimary) {
      return;
    }

    blurActiveTextEditingElement();
    const additiveSelection = isAdditiveSelection(event);
    if (!event.shiftKey && !additiveSelection && !selectedDeviceIds.includes(deviceId)) {
      onCloseContextMenu();
      rackSelection.selectSingleDevice(deviceId, orderedDeviceIds);
    }

    const orderedSelectedIds = getOrderedSelectedDeviceIdsInRack();
    const shouldDragSelection = orderedSelectedIds.includes(deviceId) && orderedSelectedIds.length > 1;
    const sourceIds = shouldDragSelection ? orderedSelectedIds : [deviceId];
    if (rackSurface.startChainDrag(event, sourceIds, 'devices')) {
      event.preventDefault();
    }
  }

  function handleDeviceHeaderClick(event: MouseEvent, deviceId: string) {
    event.stopPropagation();

    if (consumeSuppressedDeviceSelectionClick()) {
      return;
    }

    onCloseContextMenu();
    const additiveSelection = isAdditiveSelection(event);
    if (event.shiftKey) {
      rackSelection.applyRangeSelection(deviceId, additiveSelection, orderedDeviceIds);
      return;
    }

    if (additiveSelection) {
      rackSelection.toggleDeviceSelection(deviceId, orderedDeviceIds);
      void focusRackDeviceHeader(deviceId);
      return;
    }

    rackSelection.selectSingleDevice(deviceId, orderedDeviceIds);
    void focusRackDeviceHeader(deviceId);
  }

  function handleDeviceHeaderContextMenu(event: MouseEvent, deviceId: string) {
    event.stopPropagation();
    event.preventDefault();
    selectDeviceForContextMenu(deviceId);

    const deviceIds = getOrderedSelectedDeviceIdsInRack();
    onOpenContextMenu(event.clientX, event.clientY, {
      kind: 'devices',
      deviceIds,
      canGroup: canCreateGroupFromSelection(chainState.devices, deviceIds),
    });
  }

  function handleDeviceHeaderDoubleClick(event: MouseEvent, deviceId: string) {
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }
    onToggleCollapse(deviceId);
  }

  function handleChainPointerDown(event: PointerEvent) {
    rackSurface.handleChainPointerDown(event);
  }

  function handleChainContextMenu(event: MouseEvent) {
    rackSurface.handleChainContextMenu(event);
  }

  function handleChainClick(event: MouseEvent) {
    rackSurface.handleChainClick(event);
  }

  function handleChainDoubleClick(event: MouseEvent) {
    rackSurface.handleChainDoubleClick(event);
  }

  function handleChainScroll() {
    rackSurface.handleChainScroll();
    renameController.handleRackScroll();
  }

  function handleDragStart(event: DragEvent) {
    externalFileDropController.handleDragStart(event);
  }

  function handleChainDragEnter(event: DragEvent) {
    externalFileDropController.handleDragEnter(event);
  }

  function handleChainDragOver(event: DragEvent) {
    externalFileDropController.handleDragOver(event);
  }

  function handleChainDragLeave(event: DragEvent) {
    externalFileDropController.handleDragLeave(event);
  }

  async function handleChainDrop(event: DragEvent) {
    await externalFileDropController.handleDrop(event);
  }

  function handleWindowPointerMove(event: PointerEvent) {
    rackSurface.handleWindowPointerMove(event, isSidebarResizing);
  }

  function handleWindowPointerUp(event: PointerEvent) {
    rackSurface.handleWindowPointerUp(event);
  }

  function handleWindowPointerCancel(event: PointerEvent) {
    rackSurface.handleWindowPointerCancel(event);
  }

  function handleWindowBlur() {
    rackSurface.handleWindowBlur();
  }

  function handleWindowMouseUp(event: MouseEvent) {
    rackSurface.handleWindowMouseUp(event);
  }

  function handleLockedMouseMove(event: MouseEvent) {
    rackSurface.handleLockedMouseMove(event);
  }

  $effect(() => {
    void devices;
    void orderedGroupIds;
    void renameController.target;
    renameController.reconcileTarget();
  });

  $effect(() => {
    void collapsedSet;
    void renameController.target;
    renameController.syncPopoverTarget();
  });

  $effect(() => {
    onRackApiReady(rackSurface.api);

    return () => {
      onRackApiReady(null);
    };
  });

  onMount(() => renameController.mount());

  onMount(() => {
    if (!chainDevicesEl || !dropIndicatorEl || !browserDragBadgeEl) {
      return undefined;
    }

    return rackSurface.mount({
      chainDevices: chainDevicesEl,
      dropIndicator: dropIndicatorEl,
      browserDragBadge: browserDragBadgeEl,
    });
  });

  $effect(() => {
    void devices;
    rackSurface.reconcileSelection();
  });

  $effect(() => {
    void chainDevicesEl;
    void miniMapLayoutSignature;
    rackSurface.syncLayout();
  });

  $effect(() => {
    renameController.setPopover(renamePopover);
  });
</script>

<svelte:window
  onpointermove={handleWindowPointerMove}
  onpointerup={handleWindowPointerUp}
  onpointercancel={handleWindowPointerCancel}
  onmouseup={handleWindowMouseUp}
  onblur={handleWindowBlur}
/>

<svelte:document
  onmousemove={handleLockedMouseMove}
/>

<section class="device-rack">
  <!-- Rack surface delegates composite pointer/keyboard interactions. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={chainDevicesEl}
    id="chain-devices"
    class="chain-devices"
    oninput={handleChainControlInputOrChange}
    onchange={handleChainControlInputOrChange}
    onfocusin={handleChainFocusIn}
    onkeydown={handleChainKeyDown}
    onpointerdown={handleChainPointerDown}
    oncontextmenu={handleChainContextMenu}
    onclick={handleChainClick}
    ondblclick={handleChainDoubleClick}
    onscroll={handleChainScroll}
    ondragstart={handleDragStart}
    ondragenter={handleChainDragEnter}
    ondragover={handleChainDragOver}
    ondragleave={handleChainDragLeave}
    ondrop={handleChainDrop}
  >
    {#each rackContentItems as item (item.key)}
      <div
        class={item.kind === 'device'
          ? 'device-slot device-slot--solo'
          : 'device-group is-rack'}
        class:is-disabled={item.kind === 'group' && !item.enabled}
        class:is-selected={item.kind === 'group' && selectedGroupIds.includes(item.groupId)}
        data-group-id={item.kind === 'group' ? item.groupId : undefined}
      >
        {#if item.kind === 'device'}
          <DeviceCard
            device={item.device}
            {devices}
            {deviceDisplayNameById}
            {groupDisplayNameById}
            {paletteRevision}
            {currentBeat}
            {modulationReadoutById}
            {resolvePaletteRgb}
            title={resolveDeviceDisplayName(deviceDisplayNameById, item.device.id)}
            isCollapsed={collapsedSet.has(item.device.id)}
            isDisabledByGroup={false}
            isSelected={selectedDeviceIds.includes(item.device.id)}
            isDragging={draggingDeviceIds.includes(item.device.id)}
            isRenaming={renameController.isRenamingDevice(item.device.id)}
            renameValue={renameController.resolveDeviceRenameValue(item.device.id)}
            onRenameInput={(event) => renameController.handleInput(event)}
            onRenameBlur={() => renameController.handleInputBlur()}
            onRenameKeyDown={(event) => renameController.handleInputKeyDown(event)}
            onSavePreset={handleDeviceSavePreset}
            onHeaderPointerDown={(event) => handleDeviceHeaderPointerDown(event, item.device.id)}
            onHeaderClick={(event) => handleDeviceHeaderClick(event, item.device.id)}
            onHeaderContextMenu={(event) => handleDeviceHeaderContextMenu(event, item.device.id)}
            onHeaderDoubleClick={(event) => handleDeviceHeaderDoubleClick(event, item.device.id)}
          />
        {:else if item.kind === 'group'}
          <div class="device-group-body">
            {#each buildGroupColumns(item) as col (col.key)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                class={col.kind === 'device'
                  ? 'device-slot'
                  : col.kind === 'left-rail'
                      ? 'group-rail group-rail-left'
                      : 'group-rail group-rail-right'}
                class:is-renaming={col.kind === 'left-rail' && renameController.isRenamingGroup(col.groupId)}
                onpointerdown={col.kind === 'device'
                  ? undefined
                  : renameController.isRenamingGroup(col.groupId)
                    ? undefined
                  : (event) => handleGroupRailPointerDown(event, col.groupId)}
                onclick={col.kind === 'device'
                  ? undefined
                  : renameController.isRenamingGroup(col.groupId)
                    ? undefined
                  : handleGroupRailClick}
                oncontextmenu={col.kind === 'device'
                  ? undefined
                  : renameController.isRenamingGroup(col.groupId)
                    ? undefined
                  : (event) => handleGroupRailContextMenu(event, col.groupId)}
                ondblclick={col.kind === 'device'
                  ? undefined
                  : renameController.isRenamingGroup(col.groupId)
                    ? undefined
                  : (event) => handleGroupRailDoubleClick(event, col.groupId)}
              >
                {#if col.kind === 'device'}
                  <DeviceCard
                    device={col.device}
                    {devices}
                    {deviceDisplayNameById}
                    {groupDisplayNameById}
                    {paletteRevision}
                    {currentBeat}
                    {modulationReadoutById}
                    {resolvePaletteRgb}
                    title={resolveDeviceDisplayName(deviceDisplayNameById, col.device.id)}
                    isCollapsed={collapsedSet.has(col.device.id)}
                    isDisabledByGroup={!item.enabled}
                    isSelected={selectedDeviceIds.includes(col.device.id)}
                    isDragging={draggingDeviceIds.includes(col.device.id)}
                    isRenaming={renameController.isRenamingDevice(col.device.id)}
                    renameValue={renameController.resolveDeviceRenameValue(col.device.id)}
                    onRenameInput={(event) => renameController.handleInput(event)}
                    onRenameBlur={() => renameController.handleInputBlur()}
                    onRenameKeyDown={(event) => renameController.handleInputKeyDown(event)}
                    onSavePreset={handleDeviceSavePreset}
                    onHeaderPointerDown={(event) => handleDeviceHeaderPointerDown(event, col.device.id)}
                    onHeaderClick={(event) => handleDeviceHeaderClick(event, col.device.id)}
                    onHeaderContextMenu={(event) => handleDeviceHeaderContextMenu(event, col.device.id)}
                    onHeaderDoubleClick={(event) => handleDeviceHeaderDoubleClick(event, col.device.id)}
                  />
                {:else if col.kind === 'left-rail'}
                  <div class="group-rail-controls">
                    <input
                      class="group-enabled-toggle round-checkbox"
                      type="checkbox"
                      checked={col.enabled}
                      aria-label={`${resolveGroupDisplayName(groupDisplayNameById, col.groupId)} enabled`}
                      onpointerdown={handleGroupTogglePointerDown}
                      onclick={handleGroupToggleClick}
                      onchange={(event) => handleGroupEnabledChange(event, col.groupId)}
                    />
                    <button
                      class="preset-save-button"
                      type="button"
                      aria-label={`Save preset for ${resolveGroupDisplayName(groupDisplayNameById, col.groupId)}`}
                      title={`Save preset for ${resolveGroupDisplayName(groupDisplayNameById, col.groupId)}`}
                      onpointerdown={handleGroupSavePointerDown}
                      onclick={(event) => handleGroupSaveClick(event, col.groupId)}
                      oncontextmenu={handleGroupSaveContextMenu}
                    >
                      <span class="material-symbols-rounded" aria-hidden="true">save</span>
                    </button>
                  </div>
                  <span class="group-label">{resolveGroupDisplayName(groupDisplayNameById, col.groupId)}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
    <div
      bind:this={dropIndicatorEl}
      class="drop-indicator"
      aria-hidden="true"
      hidden
    ></div>
  </div>
</section>

{#if renameController.getPopoverTarget() && renameController.popoverPosition}
  <RackRenamePopover
    bind:this={renamePopover}
    x={renameController.popoverPosition.x}
    y={renameController.popoverPosition.y}
    value={renameController.draft}
    ariaLabel={renameController.resolvePopoverAriaLabel()}
    onInput={(event) => renameController.handleInput(event)}
    onBlur={() => renameController.handleInputBlur()}
    onKeyDown={(event) => renameController.handleInputKeyDown(event)}
  />
{/if}

<div
  bind:this={browserDragBadgeEl}
  id="browser-drag-badge"
  class="browser-drag-badge"
  aria-hidden="true"
  hidden
></div>

<style lang="scss">
  .device-rack {
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    padding: var(--gap-10);

    .chain-devices {
      position: relative;
      display: flex;
      gap: var(--gap-10);
      height: 100%;
      overflow: auto;
      border-radius: var(--radius-6);
    }
  }

  .device-group {
    position: relative;
    display: flex;
    flex: 0 0 auto;
    height: 100%;
  }

  .device-group.is-rack {
    background: var(--neutral-10);
    border: 1px solid var(--neutral-20);
    border-radius: var(--radius-6);
  }

  .device-group.is-rack.is-selected {
    border-color: var(--neutral-30);
  }

  .device-group.is-rack.is-selected .group-rail-left {
    background: var(--neutral-20);
  }

  /* Visual state when group toggle is disabled. */
  .device-group.is-rack.is-disabled {
    .group-rail,
    .device-group-body {
      opacity: 0.72;
    }
  }

  .device-group-body {
    display: flex;
    flex: 0 0 auto;
  }

  .device-group.is-rack :global(.device-card) {
    border-radius: 0;
    border-top: none;
    border-bottom: none;
    border-right: none;
    border-left: none;
  }

  .device-group.is-rack .device-group-body > .device-slot + .device-slot :global(.device-card) {
    border-left: 1px solid var(--neutral-20);
  }

  .device-slot {
    position: relative;
    display: flex;
    flex: 0 0 auto;
  }

  .device-slot--solo {
    height: 100%;
  }

  .drop-indicator {
    position: absolute;
    top: 6px;
    bottom: 6px;
    width: 2px;
    transform: translateX(-1px);
    background: var(--accent-500);
    border-radius: 1px;
    pointer-events: none;
    z-index: 50;
  }

  .group-rail {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--gap-10) var(--gap-6);
    gap: var(--gap-12);
    background: var(--neutral-10);
  }

  .group-rail-controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--gap-6);
    flex: 0 0 auto;
  }

  .group-rail-left {
    min-width: 2.2rem;
    border-right: 1px solid var(--neutral-20);
    border-top-left-radius: var(--radius-6);
    border-bottom-left-radius: var(--radius-6);
  }

  .group-rail-right {
    min-width: 1rem;
    border-left: 1px solid var(--neutral-20);
    border-top-right-radius: var(--radius-6);
    border-bottom-right-radius: var(--radius-6);
  }

  .group-label {
    writing-mode: sideways-lr;
    font-size: var(--text-12);
    color: var(--neutral-90);
    line-height: 1.2;
    pointer-events: none;
  }

  .group-enabled-toggle {
    width: var(--gap-14);
    height: var(--gap-14);
    flex: 0 0 auto;
  }

  .browser-drag-badge {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 40;
    border: 1px solid var(--neutral-30);
    border-radius: var(--radius-4);
    background: var(--neutral-20);
    padding: var(--gap-4) var(--gap-8);
    font-size: var(--text-12);
    transform: translate3d(-9999px, -9999px, 0);
    opacity: 0;
  }

  .browser-drag-badge:global(.is-visible) {
    opacity: 1;
  }
</style>
