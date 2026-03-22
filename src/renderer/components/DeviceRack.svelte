<script lang="ts">
  /**
   * Renders the rack surface and translates pointer/drag interactions into commit events.
   * Integrates rack selection, drop indicators, and group rendering state.
   */
  import { onMount } from 'svelte';
  import type { GeneratorDeviceNode, GeneratorChain } from '../../shared/model';
  import type { ContextMenuTarget } from './context-menu-types';
  import type {
    BrowserPresetInsertSource,
    RackInteractionCommit,
    RackPresetFileDrop,
    RackScrollMetrics,
  } from './device-rack-types';
  import type { ChainMutationMeta } from '../features/editor/history-core';
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
  import { createDeviceRackController } from '../features/rack/device-rack-controller.svelte';
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

  const resolveGroupEnabled = (groupId: string): boolean =>
    chainState.groupStateById[groupId]?.enabled !== false;

  const groupMemberIdsByGroupId = $derived.by(() => buildGroupMemberIdsByGroupId(devices));

  const getGroupMemberIds = (groupId: string): string[] =>
    groupMemberIdsByGroupId[groupId] ?? [];

  const orderedDeviceIds = $derived.by(() =>
    devices.map((device: GeneratorDeviceNode) => device.id));
  const orderedGroupIds = $derived.by(() => buildOrderedGroupIds(devices));
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

  const controller = createDeviceRackController({
    getDevices: () => devices,
    getChainState: () => chainState,
    getCollapsedSet: () => collapsedSet,
    getOrderedDeviceIds: () => orderedDeviceIds,
    getOrderedGroupIds: () => orderedGroupIds,
    getGroupMemberIds: (groupId) => getGroupMemberIds(groupId),
    getDeviceDisplayNameById: () => deviceDisplayNameById,
    getGroupDisplayNameById: () => groupDisplayNameById,
    getInteractiveElementSelector: () => interactiveElementSelector,
    getChainDevices: () => chainDevicesEl,
    resolveMiniMapLayoutSignature: () => miniMapLayoutSignature,
    openContextMenu: (clientX, clientY, target) => onOpenContextMenu(clientX, clientY, target),
    closeContextMenu: () => onCloseContextMenu(),
    saveChain: (chain, meta) => onSaveChain(chain, meta),
    scheduleAutoPreview: (delayMs) => onScheduleAutoPreview(delayMs),
    commitRackInteraction: (commit) => onCommit(commit),
    commitPresetInsertDrop: (source, dropZone) => onPresetInsertDrop(source, dropZone),
    onScrollMetricsChange: (metrics) => onScrollMetricsChange(metrics),
    onMiniMapContentRevisionChange: (revision) => onMiniMapContentRevisionChange(revision),
    onPresetFileDrop: (payload) => onPresetFileDrop(payload),
    saveDevicePreset: (deviceId) => onSaveDevicePreset(deviceId),
    saveGroupPreset: (groupId) => onSaveGroupPreset(groupId),
    toggleGroupEnabled: (groupId, nextEnabled) => onToggleGroupEnabled(groupId, nextEnabled),
    toggleCollapse: (id) => onToggleCollapse(id),
    renameDevice: (deviceId, rawName) => onRenameDevice(deviceId, rawName),
    renameGroup: (groupId, rawName) => onRenameGroup(groupId, rawName),
  });

  const selectedDeviceIds = $derived.by(() => controller.rackSelection.state.selectedDeviceIds);
  const selectedGroupIds = $derived.by(() => controller.rackSelection.state.selectedGroupIds);
  const draggingDeviceIds = $derived.by(() => controller.draggingDeviceIds);
  const renamePopoverTarget = $derived.by(() => controller.rename.getPopoverTarget());
  const renamePopoverPosition = $derived.by(() => controller.rename.popoverPosition);
  const renameDraft = $derived.by(() => controller.rename.draft);

  $effect(() => {
    void devices;
    void orderedGroupIds;
    void renamePopoverTarget;
    controller.rename.reconcileTarget();
  });

  $effect(() => {
    void collapsedSet;
    void renamePopoverTarget;
    controller.rename.syncPopoverTarget();
  });

  $effect(() => {
    onRackApiReady(controller.surface.api);

    return () => {
      onRackApiReady(null);
    };
  });

  onMount(() => controller.rename.mount());

  onMount(() => {
    if (!chainDevicesEl || !dropIndicatorEl || !browserDragBadgeEl) {
      return undefined;
    }

    return controller.surface.mount({
      chainDevices: chainDevicesEl,
      dropIndicator: dropIndicatorEl,
      browserDragBadge: browserDragBadgeEl,
    });
  });

  $effect(() => {
    void devices;
    controller.surface.reconcileSelection();
  });

  $effect(() => {
    void chainDevicesEl;
    void miniMapLayoutSignature;
    controller.surface.syncLayout();
  });

  $effect(() => {
    controller.rename.setPopover(renamePopover);
  });
</script>

<svelte:window
  onpointermove={(event) => controller.surface.handleWindowPointerMove(event, isSidebarResizing)}
  onpointerup={(event) => controller.surface.handleWindowPointerUp(event)}
  onpointercancel={(event) => controller.surface.handleWindowPointerCancel(event)}
  onmouseup={(event) => controller.surface.handleWindowMouseUp(event)}
  onblur={() => controller.surface.handleWindowBlur()}
/>

<svelte:document
  onmousemove={(event) => controller.surface.handleLockedMouseMove(event)}
/>

<section class="device-rack">
  <!-- Rack surface delegates composite pointer/keyboard interactions. -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    bind:this={chainDevicesEl}
    id="chain-devices"
    class="chain-devices"
    oninput={(event) => controller.surface.handleChainControlInputOrChange(event)}
    onchange={(event) => controller.surface.handleChainControlInputOrChange(event)}
    onfocusin={(event) => controller.surface.handleChainFocusIn(event)}
    onkeydown={(event) => controller.handleChainKeyDown(event)}
    onpointerdown={(event) => controller.surface.handleChainPointerDown(event)}
    oncontextmenu={(event) => controller.surface.handleChainContextMenu(event)}
    onclick={(event) => controller.surface.handleChainClick(event)}
    ondblclick={(event) => controller.surface.handleChainDoubleClick(event)}
    onscroll={() => controller.handleChainScroll()}
    ondragstart={(event) => controller.externalFileDrop.handleDragStart(event)}
    ondragenter={(event) => controller.externalFileDrop.handleDragEnter(event)}
    ondragover={(event) => controller.externalFileDrop.handleDragOver(event)}
    ondragleave={(event) => controller.externalFileDrop.handleDragLeave(event)}
    ondrop={(event) => void controller.externalFileDrop.handleDrop(event)}
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
            isRenaming={controller.rename.isRenamingDevice(item.device.id)}
            renameValue={controller.rename.resolveDeviceRenameValue(item.device.id)}
            onRenameInput={(event) => controller.rename.handleInput(event)}
            onRenameBlur={() => controller.rename.handleInputBlur()}
            onRenameKeyDown={(event) => controller.rename.handleInputKeyDown(event)}
            onSavePreset={(deviceId) => controller.handleDeviceSavePreset(deviceId)}
            onHeaderPointerDown={(event) => controller.handleDeviceHeaderPointerDown(event, item.device.id)}
            onHeaderClick={(event) => controller.handleDeviceHeaderClick(event, item.device.id)}
            onHeaderContextMenu={(event) => controller.handleDeviceHeaderContextMenu(event, item.device.id)}
            onHeaderDoubleClick={(event) => controller.handleDeviceHeaderDoubleClick(event, item.device.id)}
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
                class:is-renaming={col.kind === 'left-rail' && controller.rename.isRenamingGroup(col.groupId)}
                onpointerdown={col.kind === 'device'
                  ? undefined
                  : controller.rename.isRenamingGroup(col.groupId)
                    ? undefined
                  : (event) => controller.handleGroupRailPointerDown(event, col.groupId)}
                onclick={col.kind === 'device'
                  ? undefined
                  : controller.rename.isRenamingGroup(col.groupId)
                    ? undefined
                  : (event) => controller.handleGroupRailClick(event)}
                oncontextmenu={col.kind === 'device'
                  ? undefined
                  : controller.rename.isRenamingGroup(col.groupId)
                    ? undefined
                  : (event) => controller.handleGroupRailContextMenu(event, col.groupId)}
                ondblclick={col.kind === 'device'
                  ? undefined
                  : controller.rename.isRenamingGroup(col.groupId)
                    ? undefined
                  : (event) => controller.handleGroupRailDoubleClick(event, col.groupId)}
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
                    isRenaming={controller.rename.isRenamingDevice(col.device.id)}
                    renameValue={controller.rename.resolveDeviceRenameValue(col.device.id)}
                    onRenameInput={(event) => controller.rename.handleInput(event)}
                    onRenameBlur={() => controller.rename.handleInputBlur()}
                    onRenameKeyDown={(event) => controller.rename.handleInputKeyDown(event)}
                    onSavePreset={(deviceId) => controller.handleDeviceSavePreset(deviceId)}
                    onHeaderPointerDown={(event) => controller.handleDeviceHeaderPointerDown(event, col.device.id)}
                    onHeaderClick={(event) => controller.handleDeviceHeaderClick(event, col.device.id)}
                    onHeaderContextMenu={(event) => controller.handleDeviceHeaderContextMenu(event, col.device.id)}
                    onHeaderDoubleClick={(event) => controller.handleDeviceHeaderDoubleClick(event, col.device.id)}
                  />
                {:else if col.kind === 'left-rail'}
                  <div class="group-rail-controls">
                    <input
                      class="group-enabled-toggle round-checkbox"
                      type="checkbox"
                      checked={col.enabled}
                      aria-label={`${resolveGroupDisplayName(groupDisplayNameById, col.groupId)} enabled`}
                      onpointerdown={(event) => controller.handleGroupTogglePointerDown(event)}
                      onclick={(event) => controller.handleGroupToggleClick(event)}
                      onchange={(event) => controller.handleGroupEnabledChange(event, col.groupId)}
                    />
                    <button
                      class="preset-save-button"
                      type="button"
                      aria-label={`Save preset for ${resolveGroupDisplayName(groupDisplayNameById, col.groupId)}`}
                      title={`Save preset for ${resolveGroupDisplayName(groupDisplayNameById, col.groupId)}`}
                      onpointerdown={(event) => controller.handleGroupSavePointerDown(event)}
                      onclick={(event) => controller.handleGroupSaveClick(event, col.groupId)}
                      oncontextmenu={(event) => controller.handleGroupSaveContextMenu(event)}
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

{#if renamePopoverTarget && renamePopoverPosition}
  <RackRenamePopover
    bind:this={renamePopover}
    x={renamePopoverPosition.x}
    y={renamePopoverPosition.y}
    value={renameDraft}
    ariaLabel={controller.rename.resolvePopoverAriaLabel()}
    onInput={(event) => controller.rename.handleInput(event)}
    onBlur={() => controller.rename.handleInputBlur()}
    onKeyDown={(event) => controller.rename.handleInputKeyDown(event)}
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

  .device-group.is-rack.is-selected .group-rail-right {
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
    min-width: 2rem;
    border-right: 1px solid var(--neutral-20);
    border-top-left-radius: var(--radius-6);
    border-bottom-left-radius: var(--radius-6);
  }

  .group-rail-right {
    min-width: 0.75rem;
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
