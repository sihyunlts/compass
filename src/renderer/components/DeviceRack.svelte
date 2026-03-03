<script lang="ts" module>
  import type { BrowserDeviceKind as CommitBrowserDeviceKind } from '../services/devices';
  import type {
    ChainDragSourceKind,
    RackDropZone,
  } from '../state/rack-drop';

  /** Commit payload emitted when rack drag/insert interactions complete. */
  export type RackInteractionCommit =
    | {
        kind: 'move';
        sourceKind: ChainDragSourceKind;
        sourceIds: string[];
        dropZone: RackDropZone;
      }
    | {
        kind: 'insert';
        sourceKind: CommitBrowserDeviceKind;
        dropZone: RackDropZone;
      };
</script>

<script lang="ts">
  /**
   * Renders the rack surface and translates pointer/drag interactions into commit events.
   * Integrates rack selection, drop indicators, and group rendering state.
   */
  import { onMount } from 'svelte';
  import type { GeneratorDeviceNode, GeneratorChain } from '../../shared/types';
  import { normalizeOptionalId } from '../../shared/normalize-id';
  import type { ContextMenuTarget } from '../state/context-menu';
  import type { BrowserDeviceKind } from '../services/devices';
  import { DeviceRackController, type GroupSelectionContext } from '../services/rack-controller';
  import { DragDropManager, type ActiveDragInfo } from '../services/rack-dnd';
  import DeviceCard from './DeviceCard.svelte';

  let {
    devices,
    chainState,
    collapsedDeviceIds = [] as string[],
    currentBeat = 0,
    modulationReadoutById = {},
    isSidebarResizing = false,
    interactiveElementSelector,
    onSaveChain,
    onScheduleAutoPreview,
    onOpenContextMenu,
    onCloseContextMenu,
    onGetBrowserDragBadgeLabel,
    onCommit,
    onToggleGroupEnabled = () => {},
    onToggleCollapse = () => {},
  } = $props<{
    devices: GeneratorDeviceNode[];
    chainState: GeneratorChain;
    collapsedDeviceIds?: string[];
    currentBeat?: number;
    modulationReadoutById?: Record<string, string>;
    isSidebarResizing: boolean;
    interactiveElementSelector: string;
    onSaveChain: (chain: GeneratorChain) => void;
    onScheduleAutoPreview: (delayMs?: number) => void;
    onOpenContextMenu: (clientX: number, clientY: number, target: ContextMenuTarget) => void;
    onCloseContextMenu: () => void;
    onGetBrowserDragBadgeLabel: (kind: BrowserDeviceKind) => string;
    onCommit: (commit: RackInteractionCommit) => void;
    onToggleGroupEnabled?: (groupId: string, nextEnabled: boolean) => void;
    onToggleCollapse: (id: string) => void;
  }>();

  let chainDevicesEl = $state<HTMLElement | null>(null);
  let dropIndicatorEl = $state<HTMLElement | null>(null);
  let browserDragBadgeEl = $state<HTMLElement | null>(null);

  let deviceRackController = $state<DeviceRackController | null>(null);
  let dragDropManager = $state<DragDropManager | null>(null);
  let lastIndicatorKey: string | null = null;

  type RackDeviceItem = {
    kind: 'device';
    key: string;
    device: GeneratorDeviceNode;
  };

  type RackGroupItem = {
    kind: 'group';
    key: string;
    groupId: string;
    enabled: boolean;
    devices: GeneratorDeviceNode[];
  };

  type RackItem = RackDeviceItem | RackGroupItem;
  type RackContentItem = RackItem;

  const TOP_LEVEL_DROP_TARGET_SELECTOR = '.device-slot--solo, .device-group.is-rack';
  const GROUP_DROP_TARGET_SELECTOR = '.device-group.is-rack';
  const DEVICE_CARD_SELECTOR = '.device-card';

  type GroupColumn =
    | {
        kind: 'left-rail';
        key: `rail-left-${string}`;
        groupId: string;
        enabled: boolean;
      }
    | {
        kind: 'device';
        key: string;
        device: GeneratorDeviceNode;
      }
    | {
        kind: 'right-rail';
        key: `rail-right-${string}`;
        groupId: string;
      };

  const resolveGroupEnabled = (groupId: string): boolean =>
    chainState.groupStateById[groupId]?.enabled !== false;

  const groupMemberIdsByGroupId = $derived.by(() => {
    const byGroupId: Record<string, string[]> = {};
    for (const device of devices) {
      const groupId = normalizeOptionalId(device.groupId);
      if (!groupId) {
        continue;
      }

      const memberIds = byGroupId[groupId];
      if (memberIds) {
        memberIds.push(device.id);
        continue;
      }
      byGroupId[groupId] = [device.id];
    }
    return byGroupId;
  });

  const getGroupMemberIds = (groupId: string): string[] =>
    groupMemberIdsByGroupId[groupId] ?? [];

  const rackContentItems = $derived.by((): RackContentItem[] => {
    const items: RackContentItem[] = [];
    let activeGroupId: string | null = null;
    let activeGroupDevices: GeneratorDeviceNode[] = [];

    const flushGroup = () => {
      if (!activeGroupId || activeGroupDevices.length === 0) {
        return;
      }

      const anchorId = activeGroupDevices.reduce(
        (min, device) => (device.id < min ? device.id : min),
        activeGroupDevices[0].id,
      );
      items.push({
        kind: 'group',
        key: `group-${activeGroupId}-${anchorId}`,
        groupId: activeGroupId,
        enabled: resolveGroupEnabled(activeGroupId),
        devices: activeGroupDevices,
      });
      activeGroupId = null;
      activeGroupDevices = [];
    };

    for (const device of devices) {
      const groupId = normalizeOptionalId(device.groupId);

      if (!groupId) {
        flushGroup();
        items.push({
          kind: 'device',
          key: `device-${device.id}`,
          device,
        });
        continue;
      }

      if (activeGroupId === groupId) {
        activeGroupDevices.push(device);
        continue;
      }

      flushGroup();
      activeGroupId = groupId;
      activeGroupDevices = [device];
    }

    flushGroup();
    return items;
  });

  const collapsedSet = $derived.by(() => new Set(collapsedDeviceIds));

  const buildGroupColumns = (groupItem: RackGroupItem): GroupColumn[] => {
    const columns: GroupColumn[] = groupItem.devices.map((device): GroupColumn => ({
      kind: 'device',
      key: device.id,
      device,
    }));

    const leftRail: GroupColumn = {
      kind: 'left-rail',
      key: `rail-left-${groupItem.groupId}`,
      groupId: groupItem.groupId,
      enabled: groupItem.enabled,
    };
    const rightRail: GroupColumn = {
      kind: 'right-rail',
      key: `rail-right-${groupItem.groupId}`,
      groupId: groupItem.groupId,
    };

    return [leftRail, ...columns, rightRail];
  };

  type IndicatorLayout = {
    key: string;
    leftInScrollSpace: number;
  };

  const getTopLevelItems = (): HTMLElement[] => {
    if (!chainDevicesEl) {
      return [];
    }
    return [...chainDevicesEl.children].flatMap((node) =>
      node instanceof HTMLElement
      && (
        node.classList.contains('device-slot--solo')
        || (node.classList.contains('device-group') && node.classList.contains('is-rack'))
      )
        ? [node]
        : []);
  };

  const getGroupSlots = (groupEl: HTMLElement): HTMLElement[] => {
    const body = groupEl.querySelector<HTMLElement>('.device-group-body');
    if (!body) {
      return [];
    }
    return [...body.children].flatMap((node) =>
      node instanceof HTMLElement && node.classList.contains('device-slot') ? [node] : []);
  };

  const clearDropIndicator = (): void => {
    lastIndicatorKey = null;
    if (dropIndicatorEl) {
      dropIndicatorEl.hidden = true;
      dropIndicatorEl.style.removeProperty('left');
    }
  };

  const resolveInsertionClientX = (
    items: readonly HTMLElement[],
    insertionIndex: number,
  ): number | null => {
    if (!chainDevicesEl) {
      return null;
    }

    if (items.length === 0) {
      return chainDevicesEl.getBoundingClientRect().left;
    }

    if (insertionIndex <= 0) {
      return items[0].getBoundingClientRect().left;
    }

    if (insertionIndex >= items.length) {
      return items[items.length - 1].getBoundingClientRect().right;
    }

    const prevRect = items[insertionIndex - 1].getBoundingClientRect();
    const nextRect = items[insertionIndex].getBoundingClientRect();
    return (prevRect.right + nextRect.left) / 2;
  };

  const toScrollSpaceLeft = (clientX: number): number | null => {
    if (!chainDevicesEl) {
      return null;
    }

    const containerRect = chainDevicesEl.getBoundingClientRect();
    return clientX - containerRect.left + chainDevicesEl.scrollLeft;
  };

  const resolveOutsideIndicatorLayout = (
    dropZone: { targetId: string | null; placement: 'before' | 'after' },
  ): IndicatorLayout | null => {
    if (!chainDevicesEl) {
      return null;
    }

    const topLevelItems = getTopLevelItems();
    let insertionIndex = topLevelItems.length;

    if (dropZone.targetId) {
      const targetCard = chainDevicesEl.querySelector<HTMLElement>(
        `${DEVICE_CARD_SELECTOR}[data-device-id="${CSS.escape(dropZone.targetId)}"]`,
      );
      const targetRoot = targetCard?.closest<HTMLElement>(TOP_LEVEL_DROP_TARGET_SELECTOR);
      const normalizedTargetRoot = targetRoot?.parentElement === chainDevicesEl
        ? targetRoot
        : null;
      if (normalizedTargetRoot) {
        const targetIndex = topLevelItems.indexOf(normalizedTargetRoot);
        if (targetIndex >= 0) {
          insertionIndex = dropZone.placement === 'before'
            ? targetIndex
            : targetIndex + 1;
        }
      }
    }

    const clientX = resolveInsertionClientX(topLevelItems, insertionIndex);
    if (clientX === null) {
      return null;
    }
    const leftInScrollSpace = toScrollSpaceLeft(clientX);
    if (leftInScrollSpace === null) {
      return null;
    }

    return {
      key: `outside|${insertionIndex}`,
      leftInScrollSpace,
    };
  };

  const resolveInsideGroupIndicatorLayout = (
    dropZone: { groupId: string; targetId: string; placement: 'before' | 'after' },
  ): IndicatorLayout | null => {
    if (!chainDevicesEl) {
      return null;
    }

    const groupEl = chainDevicesEl.querySelector<HTMLElement>(
      `${GROUP_DROP_TARGET_SELECTOR}[data-group-id="${CSS.escape(dropZone.groupId)}"]`,
    );
    if (!groupEl) {
      return null;
    }

    const slots = getGroupSlots(groupEl);
    const targetCard = groupEl.querySelector<HTMLElement>(
      `${DEVICE_CARD_SELECTOR}[data-device-id="${CSS.escape(dropZone.targetId)}"]`,
    );
    const targetSlot = targetCard?.closest<HTMLElement>('.device-slot') ?? null;
    const slotIndex = targetSlot ? slots.indexOf(targetSlot) : -1;
    const baseIndex = slotIndex >= 0 ? slotIndex : slots.length;
    const insertionIndex = dropZone.placement === 'before'
      ? baseIndex
      : baseIndex + 1;

    const clientX = resolveInsertionClientX(slots, insertionIndex);
    if (clientX === null) {
      return null;
    }
    const leftInScrollSpace = toScrollSpaceLeft(clientX);
    if (leftInScrollSpace === null) {
      return null;
    }

    return {
      key: `inside|${dropZone.groupId}|${insertionIndex}`,
      leftInScrollSpace,
    };
  };

  const applyDropIndicator = (info: ActiveDragInfo | null): void => {
    if (!dropIndicatorEl || !chainDevicesEl) {
      return;
    }

    if (!info || !info.didMove || !info.dropZone) {
      clearDropIndicator();
      return;
    }

    const layout = info.dropZone.kind === 'outside'
      ? resolveOutsideIndicatorLayout(info.dropZone)
      : resolveInsideGroupIndicatorLayout(info.dropZone);

    if (!layout) {
      clearDropIndicator();
      return;
    }

    if (layout.key === lastIndicatorKey) {
      return;
    }

    dropIndicatorEl.style.left = `${layout.leftInScrollSpace}px`;
    dropIndicatorEl.hidden = false;
    lastIndicatorKey = layout.key;
  };

  /** Syncs selection visuals and transient UI state after Svelte re-render. */
  export function syncAfterRender() {
    deviceRackController?.syncAfterRender();
  }

  /** Applies fallback selection when currently selected devices are deleted. */
  export function applyNextSelectionAfterDelete(deletedIds: readonly string[]) {
    deviceRackController?.applyNextSelectionAfterDelete(deletedIds);
  }

  /** Returns selected device IDs ordered by current rack layout. */
  export function getOrderedSelectedDeviceIds() {
    return deviceRackController?.getOrderedSelectedDeviceIds() ?? [];
  }

  /** Selects all provided devices in rack order. */
  export function selectAllDevices(deviceIds: readonly string[]) {
    if (!deviceRackController) {
      return;
    }

    deviceRackController.clearSelection();
    if (deviceIds.length === 0) {
      return;
    }

    const anchorId = deviceIds[deviceIds.length - 1] ?? null;
    deviceRackController.selectDeviceIds(deviceIds, anchorId);
  }

  /** Returns selected group contexts in rack order. */
  export function getSelectedGroupContexts(): GroupSelectionContext[] {
    return deviceRackController?.getSelectedGroupContexts() ?? [];
  }

  /** Clears all current device and group selections. */
  export function clearSelection() {
    deviceRackController?.clearSelection();
  }

  /** Reports whether rack pointer interactions are active. */
  export function hasPointerInteraction() {
    return (
      dragDropManager?.hasActivePointer()
      || deviceRackController?.isCenterPickerActive()
    );
  }

  /** Starts an insert drag from the browser panel into the rack. */
  export function handleBrowserPointerDown(
    sourceEvent: PointerEvent,
    kind: BrowserDeviceKind,
    itemEl: HTMLElement,
  ) {
    if (!dragDropManager) return false;

    const started = dragDropManager.startBrowserDrag(
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

  // Applies immediate chain mutations from in-card control edits.
  function handleChainControlInputOrChange(event: Event) {
    deviceRackController?.handleControlInputOrChange(event);
  }

  function handleChainFocusIn(event: FocusEvent) {
    deviceRackController?.handleChainFocusIn(event);
  }

  function handleChainKeyDown(event: KeyboardEvent) {
    deviceRackController?.handleChainKeyDown(event);
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
  }

  // Resolves whether pointer-down should start reorder drag or remain in-place edit.
  function handleChainPointerDown(event: PointerEvent) {
    if (!deviceRackController || !dragDropManager) return;

    if (deviceRackController.handleChainPointerDown(event)) {
      event.preventDefault();
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest(interactiveElementSelector)) return;

    const groupRail = target.closest<HTMLElement>('.group-rail');
    if (groupRail) {
      const groupEl = groupRail.closest<HTMLElement>('.device-group.is-rack[data-group-id]');
      const groupId = normalizeOptionalId(groupEl?.dataset.groupId);
      if (!groupId) {
        return;
      }

      deviceRackController.prepareSelectionOnPointerDown({ kind: 'group', id: groupId }, event);

      const sourceIds = getGroupMemberIds(groupId);
      if (sourceIds.length === 0) {
        return;
      }

      const started = dragDropManager.startChainDrag(event, sourceIds, 'group');
      if (started) {
        clearDropIndicator();
        event.preventDefault();
      }
      return;
    }

    const handle = target.closest<HTMLElement>('.device-head');
    if (!handle) return;

    const card = handle.closest<HTMLElement>('.device-card[data-device-id]');
    if (!card) return;

    const sourceId = card.dataset.deviceId;
    if (!sourceId) return;

    deviceRackController.prepareSelectionOnPointerDown({ kind: 'device', id: sourceId }, event);

    const orderedSelectedIds = deviceRackController.getOrderedSelectedDeviceIds();
    const shouldDragSelection = orderedSelectedIds.includes(sourceId) && orderedSelectedIds.length > 1;
    const sourceIds = shouldDragSelection ? orderedSelectedIds : [sourceId];

    const started = dragDropManager.startChainDrag(event, sourceIds, 'devices');
    if (started) {
      clearDropIndicator();
      event.preventDefault();
    }
  }

  // Opens context menu and aligns selection with the right-click target.
  function handleChainContextMenu(event: MouseEvent) {
    deviceRackController?.handleContextMenu(event);
  }

  // Applies single/multi-selection behavior based on modifier keys.
  function handleChainClick(event: MouseEvent) {
    deviceRackController?.handleClick(event);
  }

  function handleChainDoubleClick(event: MouseEvent) {
    if (deviceRackController?.handleDoubleClick(event)) {
      event.preventDefault();
      return;
    }

    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    if (target.closest(interactiveElementSelector)) {
      return;
    }

    const header = target.closest<HTMLElement>('.device-head');
    if (!header) {
      return;
    }

    const card = header.closest<HTMLElement>('.device-card[data-device-id]');
    const deviceId = card?.dataset.deviceId;
    if (!deviceId) {
      return;
    }

    onToggleCollapse(deviceId);
  }

  function handleDragStart(event: DragEvent) {
    event.preventDefault();
  }

  // Routes global pointer movement to drag-and-drop and picker controllers.
  function handleWindowPointerMove(event: PointerEvent) {
    if (isSidebarResizing) return;

    if (deviceRackController?.handleWindowPointerMove(event)) {
      event.preventDefault();
      return;
    }

    const didHandlePointerMove = dragDropManager?.handlePointerMove(event) ?? false;
    if (didHandlePointerMove) {
      event.preventDefault();
    }
  }

  // Finalizes pointer-up results and commits move/insert mutations.
  function handleWindowPointerUp(event: PointerEvent) {
    if (deviceRackController?.handleWindowPointerUp(event)) {
      return;
    }

    const pointerResult = dragDropManager?.handlePointerUp(event);
    if (!pointerResult) {
      return;
    }

    if (pointerResult.kind === 'chain') {
      if (pointerResult.didMove) {
        deviceRackController?.markSuppressSelectionClickOnce();
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
    if (deviceRackController?.handleWindowPointerCancel(event)) {
      return;
    }
    dragDropManager?.handlePointerCancel(event);
  }

  function handleWindowBlur() {
    deviceRackController?.handleWindowBlur();
  }

  function handleWindowMouseUp(event: MouseEvent) {
    deviceRackController?.handleWindowMouseUp(event);
  }

  function handlePointerLockChange() {
    deviceRackController?.handlePointerLockChange();
  }

  function handleLockedMouseMove(event: MouseEvent) {
    deviceRackController?.handleLockedMouseMove(event);
  }

  onMount(() => {
    if (!chainDevicesEl || !browserDragBadgeEl) return;

    deviceRackController = new DeviceRackController({
      chainDevices: chainDevicesEl,
      interactiveElementSelector,
      getChainState: () => chainState,
      saveChain: onSaveChain,
      scheduleAutoPreview: onScheduleAutoPreview,
      openContextMenu: onOpenContextMenu,
      closeContextMenu: onCloseContextMenu,
    });

    dragDropManager = new DragDropManager({
      chainDevices: chainDevicesEl,
      browserDragBadge: browserDragBadgeEl,
      isBlocked: () => deviceRackController?.isCenterPickerActive() ?? false,
      closeContextMenu: onCloseContextMenu,
      onDragUpdate: (info) => applyDropIndicator(info),
    });

    document.addEventListener('pointerlockchange', handlePointerLockChange);

    return () => {
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      clearDropIndicator();
      dragDropManager = null;
      deviceRackController = null;
    };
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
    ondragstart={handleDragStart}
  >
    {#each rackContentItems as item (item.key)}
      <div
        class={item.kind === 'device'
          ? 'device-slot device-slot--solo'
          : 'device-group is-rack'}
        class:is-disabled={item.kind === 'group' && !item.enabled}
        data-group-id={item.kind === 'group' ? item.groupId : undefined}
      >
        {#if item.kind === 'device'}
          <DeviceCard
            device={item.device}
            {devices}
            {currentBeat}
            {modulationReadoutById}
            isCollapsed={collapsedSet.has(item.device.id)}
            isDisabledByGroup={false}
          />
        {:else if item.kind === 'group'}
          <div class="device-group-body">
            {#each buildGroupColumns(item) as col (col.key)}
              <div
                class={col.kind === 'device'
                  ? 'device-slot'
                  : col.kind === 'left-rail'
                      ? 'group-rail group-rail-left'
                      : 'group-rail group-rail-right'}
              >
                {#if col.kind === 'device'}
                  <DeviceCard
                    device={col.device}
                    {devices}
                    {currentBeat}
                    {modulationReadoutById}
                    isCollapsed={collapsedSet.has(col.device.id)}
                    isDisabledByGroup={!item.enabled}
                  />
                {:else if col.kind === 'left-rail'}
                  <input
                    class="group-enabled-toggle"
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

  /* Group selection state class is toggled via classList in rack-controller. */
  :global(.device-group.is-rack.is-selected) {
    border-color: var(--neutral-30);
  }

  :global(.device-group.is-rack.is-selected .group-rail-left) {
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
    margin: 0;
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
