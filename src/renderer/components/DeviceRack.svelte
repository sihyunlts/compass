<script lang="ts">
  /**
   * Renders the rack surface and translates pointer/drag interactions into commit events.
   * Integrates rack selection, drop indicators, and group rendering state.
   */
  import { onMount } from 'svelte';
  import { clamp } from '../../shared/math';
  import type { GeneratorDeviceNode, GeneratorChain } from '../../shared/model';
  import type { ContextMenuTarget } from './context-menu-types';
  import type {
    RackInteractionCommit,
    RackScrollMetrics,
  } from './device-rack-types';
  import type { BrowserDeviceKind } from '../services/devices';
  import { canCreateGroupFromSelection } from '../features/editor/chain-ops';
  import type { ChainMutationMeta } from '../features/editor/history-core';
  import { blurIfTextEditingElement } from '../features/rack/text-editing';
  import {
    createRackSelection,
  } from '../features/rack/selection.svelte';
  import { RackDragController, type ActiveDragInfo } from '../features/rack/drag-controller';
  import { RackDropIndicator } from '../features/rack/drop-indicator';
  import {
    buildGroupColumns,
    buildGroupMemberIdsByGroupId,
    buildOrderedGroupIds,
    buildRackContentItems,
  } from '../features/rack/layout';
  import { createRackViewApi, type RackViewApi } from '../features/rack/api';
  import { RackInteractionManager } from '../features/rack/interaction-manager';
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
    onGetBrowserDragBadgeLabel,
    onCommit,
    onScrollMetricsChange = () => {},
    onMiniMapContentRevisionChange = () => {},
    onToggleGroupEnabled = () => {},
    onToggleCollapse = () => {},
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
    onGetBrowserDragBadgeLabel: (kind: BrowserDeviceKind) => string;
    onCommit: (commit: RackInteractionCommit) => void;
    onScrollMetricsChange?: (metrics: RackScrollMetrics) => void;
    onMiniMapContentRevisionChange?: (revision: number) => void;
    onToggleGroupEnabled?: (groupId: string, nextEnabled: boolean) => void;
    onToggleCollapse: (id: string) => void;
    onRackApiReady?: (api: RackViewApi | null) => void;
  }>();

  let chainDevicesEl = $state<HTMLElement | null>(null);
  let dropIndicatorEl = $state<HTMLElement | null>(null);
  let browserDragBadgeEl = $state<HTMLElement | null>(null);

  const rackSelection = createRackSelection();
  let rackInteractionManager = $state<RackInteractionManager | null>(null);
  let rackDragController = $state<RackDragController | null>(null);
  let dropIndicator = $state<RackDropIndicator | null>(null);
  let activeDragInfo = $state<ActiveDragInfo | null>(null);
  let suppressDeviceSelectionClick = false;
  let resizeObserver: ResizeObserver | null = null;
  let resizeSyncFrameId: number | null = null;
  let lastScrollMetricsSignature: string | null = null;
  let lastMiniMapLayoutSignature: string | null = null;
  let miniMapContentRevision = 0;

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
  const draggingDeviceIds = $derived.by(() =>
    activeDragInfo?.kind === 'chain' && activeDragInfo.didMove
      ? activeDragInfo.sourceIds
      : []);

  const rackContentItems = $derived.by(() =>
    buildRackContentItems(devices, resolveGroupEnabled));

  const collapsedSet = $derived.by(() => new Set(collapsedDeviceIds));

  const toScrollMetricsSignature = (metrics: RackScrollMetrics): string => (
    `${metrics.scrollLeft.toFixed(2)}|${metrics.scrollWidth.toFixed(2)}|${metrics.clientWidth.toFixed(2)}`
  );

  const resolveScrollMetrics = (): RackScrollMetrics | null => {
    if (!chainDevicesEl) {
      return null;
    }

    const scrollWidth = Math.max(chainDevicesEl.scrollWidth, 0);
    const clientWidth = Math.max(chainDevicesEl.clientWidth, 0);
    const maxScrollLeft = Math.max(scrollWidth - clientWidth, 0);
    const scrollLeft = clamp(chainDevicesEl.scrollLeft, 0, maxScrollLeft);

    return {
      scrollLeft,
      scrollWidth,
      clientWidth,
    };
  };

  const emitScrollMetrics = (): RackScrollMetrics | null => {
    const metrics = resolveScrollMetrics();
    if (!metrics) {
      return null;
    }

    const signature = toScrollMetricsSignature(metrics);
    if (signature === lastScrollMetricsSignature) {
      return metrics;
    }

    lastScrollMetricsSignature = signature;
    onScrollMetricsChange(metrics);
    return metrics;
  };

  const miniMapLayoutSignature = $derived.by(() => {
    const rackOrderSignature = rackContentItems
      .map((item) =>
        item.kind === 'device'
          ? `d:${item.device.id}`
          : `g:${item.groupId}:${item.enabled ? '1' : '0'}:${item.devices.map((device) => device.id).join(',')}`)
      .join('|');
    const collapsedSignature = collapsedDeviceIds.join('|');
    return `${rackOrderSignature}::collapsed:${collapsedSignature}`;
  });

  const emitMiniMapContentRevision = (layoutSignature: string): void => {
    if (layoutSignature === lastMiniMapLayoutSignature) {
      return;
    }

    lastMiniMapLayoutSignature = layoutSignature;
    miniMapContentRevision += 1;
    onMiniMapContentRevisionChange(miniMapContentRevision);
  };

  const queueScrollMetricsSync = (): void => {
    if (resizeSyncFrameId !== null) {
      return;
    }

    resizeSyncFrameId = window.requestAnimationFrame(() => {
      resizeSyncFrameId = null;
      emitScrollMetrics();
    });
  };

  const clearDropIndicator = (): void => {
    dropIndicator?.clear();
  };

  const getOrderedSelectedDeviceIdsInRack = (): string[] =>
    rackSelection.getOrderedSelectedDeviceIds(orderedDeviceIds);

  const isAdditiveSelection = (event: { metaKey: boolean; ctrlKey: boolean }): boolean =>
    event.metaKey || event.ctrlKey;

  const blurActiveTextEditingElement = (): void => {
    blurIfTextEditingElement(document.activeElement);
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

  /** Syncs selection state and transient UI state after Svelte re-render. */
  function syncAfterRender() {
    rackSelection.reconcileWithDevices(devices);
    rackInteractionManager?.syncAfterRender();
  }

  /** Reports whether rack pointer interactions are active. */
  function hasPointerInteraction() {
    return (
      (rackDragController?.hasActivePointer() ?? false)
      || (rackInteractionManager?.isCenterPickerActive() ?? false)
    );
  }

  /** Applies horizontal scroll offset requested from external minimap controls. */
  function setScrollLeft(nextScrollLeft: number) {
    if (!chainDevicesEl || !Number.isFinite(nextScrollLeft)) {
      return;
    }

    const maxScrollLeft = Math.max(chainDevicesEl.scrollWidth - chainDevicesEl.clientWidth, 0);
    const clamped = clamp(nextScrollLeft, 0, maxScrollLeft);
    if (Math.abs(chainDevicesEl.scrollLeft - clamped) > 0.1) {
      chainDevicesEl.scrollLeft = clamped;
    }

    emitScrollMetrics();
  }

  /** Starts an insert drag from the browser panel into the rack. */
  function handleBrowserPointerDown(
    sourceEvent: PointerEvent,
    kind: BrowserDeviceKind,
    itemEl: HTMLElement,
  ) {
    if (!rackDragController) return false;

    const started = rackDragController.startBrowserDrag(
      sourceEvent,
      kind,
      itemEl,
      onGetBrowserDragBadgeLabel(kind),
    );

    if (started) {
      clearDropIndicator();
      sourceEvent.preventDefault();
    }

    return started;
  }

  const rackViewApi: RackViewApi = createRackViewApi({
    rackSelection,
    getDevices: () => devices,
    getOrderedDeviceIds: () => orderedDeviceIds,
    syncAfterRender,
    hasPointerInteraction,
    setScrollLeft,
    handleBrowserPointerDown,
  });

  // Applies immediate chain mutations from in-card control edits.
  function handleChainControlInputOrChange(event: Event) {
    rackInteractionManager?.handleControlInputOrChange(event);
  }

  function handleChainFocusIn(event: FocusEvent) {
    rackInteractionManager?.handleChainFocusIn(event);
  }

  function handleChainKeyDown(event: KeyboardEvent) {
    rackInteractionManager?.handleChainKeyDown(event);
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
    if (suppressDeviceSelectionClick) {
      suppressDeviceSelectionClick = false;
    }
  }

  function handleGroupRailPointerDown(event: PointerEvent, groupId: string) {
    if (!rackDragController) {
      return;
    }

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

    const started = rackDragController.startChainDrag(event, sourceIds, 'group');
    if (started) {
      clearDropIndicator();
      event.preventDefault();
    }
  }

  function handleGroupRailClick(event: MouseEvent) {
    event.stopPropagation();

    if (suppressDeviceSelectionClick) {
      suppressDeviceSelectionClick = false;
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

  function handleDeviceHeaderPointerDown(event: PointerEvent, deviceId: string) {
    if (!rackDragController) {
      return;
    }

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
    const started = rackDragController.startChainDrag(event, sourceIds, 'devices');
    if (started) {
      clearDropIndicator();
      event.preventDefault();
    }
  }

  function handleDeviceHeaderClick(event: MouseEvent, deviceId: string) {
    event.stopPropagation();

    if (suppressDeviceSelectionClick) {
      suppressDeviceSelectionClick = false;
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
      return;
    }

    rackSelection.selectSingleDevice(deviceId, orderedDeviceIds);
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

  // Resolves whether pointer-down should start reorder drag or remain in-place edit.
  function handleChainPointerDown(event: PointerEvent) {
    if (rackInteractionManager?.handleChainPointerDown(event)) {
      event.preventDefault();
    }
  }

  function handleChainContextMenu(event: MouseEvent) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      onCloseContextMenu();
      return;
    }

    if (target.closest(interactiveElementSelector)) {
      onCloseContextMenu();
      return;
    }

    onCloseContextMenu();
  }

  function handleChainClick(event: MouseEvent) {
    if (suppressDeviceSelectionClick) {
      suppressDeviceSelectionClick = false;
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest('.center-point-control')) {
      return;
    }

    if (target.closest('.modulation-curve-control')) {
      return;
    }

    if (target.closest(interactiveElementSelector)) {
      return;
    }

    if (!event.metaKey && !event.ctrlKey && !event.shiftKey) {
      rackSelection.clear();
    }
    onCloseContextMenu();
  }

  function handleChainDoubleClick(event: MouseEvent) {
    if (rackInteractionManager?.handleDoubleClick(event)) {
      event.preventDefault();
    }
  }

  function handleChainScroll() {
    emitScrollMetrics();
  }

  function handleDragStart(event: DragEvent) {
    event.preventDefault();
  }

  // Routes global pointer movement to drag-and-drop and picker controllers.
  function handleWindowPointerMove(event: PointerEvent) {
    if (isSidebarResizing) return;

    if (rackInteractionManager?.handleWindowPointerMove(event)) {
      event.preventDefault();
      return;
    }

    const didHandlePointerMove = rackDragController?.handlePointerMove(event) ?? false;
    if (didHandlePointerMove) {
      event.preventDefault();
    }
  }

  // Finalizes pointer-up results and commits move/insert mutations.
  function handleWindowPointerUp(event: PointerEvent) {
    if (rackInteractionManager?.handleWindowPointerUp(event)) {
      return;
    }

    const pointerResult = rackDragController?.handlePointerUp(event);
    if (!pointerResult) {
      return;
    }

    if (pointerResult.kind === 'chain') {
      if (pointerResult.didMove) {
        suppressDeviceSelectionClick = true;
      }

      if (pointerResult.shouldCommit && pointerResult.dropZone) {
        onCommit({
          kind: 'move',
          sourceKind: pointerResult.sourceKind,
          sourceIds: pointerResult.sourceIds,
          dropZone: pointerResult.dropZone,
        });
      }
    } else if (pointerResult.shouldCommit && pointerResult.dropZone) {
      onCommit({
        kind: 'insert',
        sourceKind: pointerResult.sourceKind,
        dropZone: pointerResult.dropZone,
      });
    }
  }

  // Cancels active pointer interactions when the browser emits pointer-cancel.
  function handleWindowPointerCancel(event: PointerEvent) {
    if (rackInteractionManager?.handleWindowPointerCancel(event)) {
      return;
    }
    rackDragController?.handlePointerCancel(event);
  }

  function handleWindowBlur() {
    rackInteractionManager?.handleWindowBlur();
  }

  function handleWindowMouseUp(event: MouseEvent) {
    rackInteractionManager?.handleWindowMouseUp(event);
  }

  function handlePointerLockChange() {
    rackInteractionManager?.handlePointerLockChange();
  }

  function handleLockedMouseMove(event: MouseEvent) {
    rackInteractionManager?.handleLockedMouseMove(event);
  }

  $effect(() => {
    onRackApiReady(rackViewApi);

    return () => {
      onRackApiReady(null);
    };
  });

  onMount(() => {
    if (!chainDevicesEl || !dropIndicatorEl || !browserDragBadgeEl) return;

    rackInteractionManager = new RackInteractionManager({
      chainDevices: chainDevicesEl,
      getChainState: () => chainState,
      saveChain: onSaveChain,
      scheduleAutoPreview: onScheduleAutoPreview,
      closeContextMenu: onCloseContextMenu,
    });

    dropIndicator = new RackDropIndicator({
      chainDevices: chainDevicesEl,
      indicator: dropIndicatorEl,
    });

    rackDragController = new RackDragController({
      chainDevices: chainDevicesEl,
      browserDragBadge: browserDragBadgeEl,
      isBlocked: () => rackInteractionManager?.isCenterPickerActive() ?? false,
      closeContextMenu: onCloseContextMenu,
      onDragUpdate: (info) => {
        activeDragInfo = info;
        dropIndicator?.sync(info);
      },
    });

    resizeObserver = new ResizeObserver(() => {
      queueScrollMetricsSync();
    });
    resizeObserver.observe(chainDevicesEl);
    emitScrollMetrics();
    emitMiniMapContentRevision(miniMapLayoutSignature);

    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      clearDropIndicator();
      if (resizeSyncFrameId !== null) {
        window.cancelAnimationFrame(resizeSyncFrameId);
        resizeSyncFrameId = null;
      }
      resizeObserver?.disconnect();
      resizeObserver = null;
      activeDragInfo = null;
      rackDragController = null;
      dropIndicator = null;
      rackInteractionManager = null;
    };
  });

  $effect(() => {
    rackSelection.reconcileWithDevices(devices);
  });

  $effect(() => {
    if (!chainDevicesEl) {
      return;
    }

    queueScrollMetricsSync();
    emitMiniMapContentRevision(miniMapLayoutSignature);
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
            {paletteRevision}
            {currentBeat}
            {modulationReadoutById}
            {resolvePaletteRgb}
            isCollapsed={collapsedSet.has(item.device.id)}
            isDisabledByGroup={false}
            isSelected={selectedDeviceIds.includes(item.device.id)}
            isDragging={draggingDeviceIds.includes(item.device.id)}
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
                onpointerdown={col.kind === 'device'
                  ? undefined
                  : (event) => handleGroupRailPointerDown(event, col.groupId)}
                onclick={col.kind === 'device'
                  ? undefined
                  : handleGroupRailClick}
                oncontextmenu={col.kind === 'device'
                  ? undefined
                  : (event) => handleGroupRailContextMenu(event, col.groupId)}
              >
                {#if col.kind === 'device'}
                  <DeviceCard
                    device={col.device}
                    {devices}
                    {paletteRevision}
                    {currentBeat}
                    {modulationReadoutById}
                    {resolvePaletteRgb}
                    isCollapsed={collapsedSet.has(col.device.id)}
                    isDisabledByGroup={!item.enabled}
                    isSelected={selectedDeviceIds.includes(col.device.id)}
                    isDragging={draggingDeviceIds.includes(col.device.id)}
                    onHeaderPointerDown={(event) => handleDeviceHeaderPointerDown(event, col.device.id)}
                    onHeaderClick={(event) => handleDeviceHeaderClick(event, col.device.id)}
                    onHeaderContextMenu={(event) => handleDeviceHeaderContextMenu(event, col.device.id)}
                    onHeaderDoubleClick={(event) => handleDeviceHeaderDoubleClick(event, col.device.id)}
                  />
                {:else if col.kind === 'left-rail'}
                  <input
                    class="group-enabled-toggle round-checkbox"
                    type="checkbox"
                    checked={col.enabled}
                    aria-label={`${col.groupId} enabled`}
                    onpointerdown={handleGroupTogglePointerDown}
                    onclick={handleGroupToggleClick}
                    onchange={(event) => handleGroupEnabledChange(event, col.groupId)}
                  />
                  <span class="group-label">{col.groupId}</span>
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
    align-items: stretch;
    height: 100%;
  }

  .device-group.is-rack {
    position: relative;
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
    gap: 0;
    align-items: stretch;
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
    align-items: stretch;
  }

  .device-slot--solo {
    position: relative;
    height: 100%;
  }

  .device-group.is-rack .device-slot {
    position: relative;
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

  .drop-indicator[hidden] {
    display: none;
  }

  .group-rail {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: flex-start;
    padding: var(--gap-10) var(--gap-6);
    gap: var(--gap-12);
    background: var(--neutral-10);
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
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: var(--text-12);
    color: var(--neutral-90);
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
