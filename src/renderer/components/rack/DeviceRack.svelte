<script lang="ts">
  /**
   * Renders the rack surface and translates pointer/drag interactions into commit events.
   * Integrates rack selection, drop indicators, and group rendering state.
   */
  import { onMount } from 'svelte';
  import {
    isCurveModulatorNode,
    type GeneratorDeviceNode,
    type GeneratorChain,
  } from '../../../shared/model';
  import type { ContextMenuTarget } from '../../features/context-menu/types';
  import type { ModulationStateByParameter } from '../../../shared/contracts/preview/modulation';
  import type {
    BrowserNonRackPresetInsertSource,
    BrowserPresetInsertSource,
    RackInteractionCommit,
    RackPresetFileDrop,
    RackScrollMetrics,
  } from '../../features/rack/types';
  import type { ChainMutationMeta } from '../../features/editor/history-core';
  import {
    buildGroupColumns,
    buildGroupMemberIdsByGroupId,
    buildOrderedGroupIds,
    buildRackContentItems,
  } from '../../features/rack/layout';
  import type { RackDropZone } from '../../features/rack/drop-ops';
  import type { RackViewApi } from '../../features/rack/api';
  import {
    buildDeviceDisplayNameById,
    buildGroupDisplayNameById,
  } from '../../features/rack/display-names';
  import {
    resolveDeviceDisplayName,
    resolveGroupDisplayName,
  } from '../../features/rack/rename';
  import { hint } from '../overlays/hint';
  import { createDeviceRackController } from '../../features/rack/device-rack-controller.svelte';
  import RackRenamePopover from './RackRenamePopover.svelte';
  import DeviceCard from './DeviceCard.svelte';
  import { i18n } from '../../i18n.svelte';
  import { getDeviceMessageKey } from '../../device-i18n';

  let {
    devices,
    chainState,
    collapsedDeviceIds = [] as string[],
    paletteRevision,
    currentBeatBeats = 0,
    currentProgress01 = 0,
    modulationReadoutById = {},
    modulationStateByParameter = {},
    resolvePaletteRgb,
    isSidebarResizing = false,
    interactiveElementSelector,
    onSaveChain,
    onScheduleAutoPreview,
    onOpenContextMenu,
    onCloseContextMenu,
    onCommit,
    onPresetInsertDrop = () => {},
    onRackPresetDrop = () => {},
    onScrollMetricsChange = () => {},
    onMiniMapContentRevisionChange = (): void => {},
    getFilePath = (): string | null => null,
    onPresetFileDrop = async (): Promise<void> => {},
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
    currentBeatBeats?: number;
    currentProgress01?: number;
    modulationReadoutById?: Record<string, string>;
    modulationStateByParameter?: ModulationStateByParameter;
    resolvePaletteRgb: (velocity: number) => string;
    isSidebarResizing: boolean;
    interactiveElementSelector: string;
    onSaveChain: (chain: GeneratorChain, meta: ChainMutationMeta) => void;
    onScheduleAutoPreview: (delayMs?: number) => void;
    onOpenContextMenu: (clientX: number, clientY: number, target: ContextMenuTarget) => void;
    onCloseContextMenu: () => void;
    onCommit: (commit: RackInteractionCommit) => void;
    onPresetInsertDrop?: (
      source: BrowserNonRackPresetInsertSource,
      dropZone: RackDropZone,
    ) => void;
    onRackPresetDrop?: (source: Extract<BrowserPresetInsertSource, { kind: 'rack-preset' }>) => void;
    onScrollMetricsChange?: (metrics: RackScrollMetrics) => void;
    onMiniMapContentRevisionChange?: (revision: number) => void;
    getFilePath?: (file: File) => string | null;
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
  let mappingCaptureModulatorId = $state<string | null>(null);
  let mappingCaptureSlotIndex = $state<number | null>(null);

  const resolveGroupEnabled = (groupId: string): boolean =>
    chainState.groupStateById[groupId]?.enabled !== false;

  const groupMemberIdsByGroupId = $derived.by(() => buildGroupMemberIdsByGroupId(devices));

  const getGroupMemberIds = (groupId: string): string[] =>
    groupMemberIdsByGroupId[groupId] ?? [];

  const orderedDeviceIds = $derived.by(() =>
    devices.map((device: GeneratorDeviceNode) => device.id));
  const orderedGroupIds = $derived.by(() => buildOrderedGroupIds(devices));
  const collapsedSet = $derived.by(() => new Set<string>(collapsedDeviceIds));
  const deviceDisplayNameById = $derived.by(() => buildDeviceDisplayNameById(
    devices,
    (kind) => i18n.t(getDeviceMessageKey(kind)),
  ));
  const groupDisplayNameById = $derived.by(() =>
    buildGroupDisplayNameById(
      devices,
      chainState.groupStateById,
      i18n.t('group.defaultTemplate'),
    ));
  const rackContentItems = $derived.by(() =>
    buildRackContentItems(devices, resolveGroupEnabled));

  const isModulatorDeviceId = (deviceId: string): boolean => {
    const device = devices.find(
      (item: GeneratorDeviceNode) => item.id === deviceId,
    ) ?? null;
    return device !== null && isCurveModulatorNode(device);
  };

  const setMappingCapture = (modulatorId: string | null, slotIndex: number | null): void => {
    mappingCaptureModulatorId = modulatorId;
    mappingCaptureSlotIndex = slotIndex;
  };

  const handleDeviceTabChange = (deviceId: string, tabId: string): void => {
    if (!isModulatorDeviceId(deviceId)) {
      return;
    }

    if (tabId === 'map') {
      setMappingCapture(deviceId, null);
      return;
    }

    if (mappingCaptureModulatorId === deviceId) {
      setMappingCapture(null, null);
    }
  };

  const handleModulationTargetSlotSelect = (deviceId: string, slotIndex: number): void => {
    if (!isModulatorDeviceId(deviceId)) {
      return;
    }

    if (mappingCaptureModulatorId === deviceId && mappingCaptureSlotIndex === slotIndex) {
      setMappingCapture(deviceId, null);
      return;
    }

    setMappingCapture(deviceId, slotIndex);
  };

  const handleModulationTargetPick = (
    targetDeviceId: string,
    paramKey: string,
  ): void => {
    const modulatorId = mappingCaptureModulatorId;
    const slotIndex = mappingCaptureSlotIndex;
    if (!modulatorId || slotIndex === null) {
      return;
    }

    controller.surface.handleControlChange({
      action: 'assign-modulation-target-slot',
      deviceId: modulatorId,
      value: {
        slotIndex,
        deviceId: targetDeviceId,
        paramKey,
      },
      finalize: true,
    });
    setMappingCapture(modulatorId, null);
  };

  const handleModulationParameterContextMenu = (
    event: MouseEvent,
    deviceId: string,
    paramKey: string,
  ): boolean => {
    const targetDevice = devices.find((device: GeneratorDeviceNode) => device.id === deviceId);
    if (!targetDevice) {
      return false;
    }

    const connections = devices.flatMap((device: GeneratorDeviceNode) => {
      if (!isCurveModulatorNode(device)) {
        return [];
      }
      return device.params.targets
        .filter((target) => target.deviceId === deviceId && target.paramKey === paramKey)
        .map((target) => ({
          modulatorId: device.id,
          modulatorLabel: deviceDisplayNameById[device.id]
            ?? i18n.t(getDeviceMessageKey(device.kind)),
          targetId: target.id,
        }));
    });
    if (connections.length === 0) {
      return false;
    }

    onOpenContextMenu(event.clientX, event.clientY, {
      kind: 'modulation-parameter',
      deviceId,
      paramKey,
      connections,
    });
    return true;
  };

  const clearMappingCaptureSlot = (): void => {
    if (mappingCaptureSlotIndex !== null) {
      setMappingCapture(mappingCaptureModulatorId, null);
    }
  };

  const handleChainPointerDown = (event: PointerEvent): void => {
    clearMappingCaptureSlot();
    controller.surface.handleChainPointerDown(event);
  };

  $effect(() => {
    window.addEventListener('pointerdown', clearMappingCaptureSlot);
    return () => {
      window.removeEventListener('pointerdown', clearMappingCaptureSlot);
    };
  });
  const isRackEmpty = $derived(rackContentItems.length === 0);

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
    commitRackPresetDrop: (source) => onRackPresetDrop(source),
    onScrollMetricsChange: (metrics) => onScrollMetricsChange(metrics),
    onMiniMapContentRevisionChange: (revision) => onMiniMapContentRevisionChange(revision),
    getFilePath: (file) => getFilePath(file),
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
    onfocusin={(event) => controller.surface.handleChainFocusIn(event)}
    onkeydown={(event) => controller.handleChainKeyDown(event)}
    onpointerdown={handleChainPointerDown}
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
    {#if isRackEmpty}
      <p class="rack-empty-message">{i18n.t('rack.dropHere')}</p>
    {/if}

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
            {currentBeatBeats}
            {currentProgress01}
            {modulationReadoutById}
            {modulationStateByParameter}
            {resolvePaletteRgb}
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
            {mappingCaptureModulatorId}
            {mappingCaptureSlotIndex}
            onDeviceTabChange={handleDeviceTabChange}
            onModulationTargetSlotSelect={handleModulationTargetSlotSelect}
            onModulationTargetPick={handleModulationTargetPick}
            onModulationParameterContextMenu={handleModulationParameterContextMenu}
            onControlChange={(change) => controller.surface.handleControlChange(change)}
            onHeaderPointerDown={(event) => {
              clearMappingCaptureSlot();
              controller.handleDeviceHeaderPointerDown(event, item.device.id);
            }}
            onHeaderClick={(event) => {
              clearMappingCaptureSlot();
              controller.handleDeviceHeaderClick(event, item.device.id);
            }}
            onHeaderContextMenu={(event) => controller.handleDeviceHeaderContextMenu(event, item.device.id)}
            onHeaderDoubleClick={(event) => controller.handleDeviceHeaderDoubleClick(event, item.device.id)}
          />
        {:else if item.kind === 'group'}
          {@const isGroupSelected = selectedGroupIds.includes(item.groupId)}
          {@const firstGroupDeviceId = item.devices[0]?.id}
          {@const lastGroupDeviceId = item.devices.at(-1)?.id}
          <div class="device-group-body">
            {#each buildGroupColumns(item) as col (col.key)}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <div
                class={col.kind === 'device'
                  ? 'device-slot'
                  : col.kind === 'left-rail'
                      ? 'group-rail group-rail-left'
                      : 'group-rail group-rail-right'}
                class:is-selected={col.kind === 'device'
                  ? isGroupSelected || selectedDeviceIds.includes(col.device.id)
                  : col.kind === 'left-rail'
                    ? isGroupSelected
                      || (firstGroupDeviceId !== undefined
                        && selectedDeviceIds.includes(firstGroupDeviceId))
                    : isGroupSelected
                      || (lastGroupDeviceId !== undefined
                        && selectedDeviceIds.includes(lastGroupDeviceId))}
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
                    {currentBeatBeats}
                    {currentProgress01}
                    {modulationReadoutById}
                    {modulationStateByParameter}
                    {resolvePaletteRgb}
                    isCollapsed={collapsedSet.has(col.device.id)}
                    isDisabledByGroup={!item.enabled}
                    isSelected={isGroupSelected || selectedDeviceIds.includes(col.device.id)}
                    isDragging={draggingDeviceIds.includes(col.device.id)}
                    isRenaming={controller.rename.isRenamingDevice(col.device.id)}
                    renameValue={controller.rename.resolveDeviceRenameValue(col.device.id)}
                    onRenameInput={(event) => controller.rename.handleInput(event)}
                    onRenameBlur={() => controller.rename.handleInputBlur()}
                    onRenameKeyDown={(event) => controller.rename.handleInputKeyDown(event)}
                    onSavePreset={(deviceId) => controller.handleDeviceSavePreset(deviceId)}
                    {mappingCaptureModulatorId}
                    {mappingCaptureSlotIndex}
                    onDeviceTabChange={handleDeviceTabChange}
                    onModulationTargetSlotSelect={handleModulationTargetSlotSelect}
                    onModulationTargetPick={handleModulationTargetPick}
                    onModulationParameterContextMenu={handleModulationParameterContextMenu}
                    onControlChange={(change) => controller.surface.handleControlChange(change)}
                    onHeaderPointerDown={(event) => {
                      clearMappingCaptureSlot();
                      controller.handleDeviceHeaderPointerDown(event, col.device.id);
                    }}
                    onHeaderClick={(event) => {
                      clearMappingCaptureSlot();
                      controller.handleDeviceHeaderClick(event, col.device.id);
                    }}
                    onHeaderContextMenu={(event) => controller.handleDeviceHeaderContextMenu(event, col.device.id)}
                    onHeaderDoubleClick={(event) => controller.handleDeviceHeaderDoubleClick(event, col.device.id)}
                  />
                {:else if col.kind === 'left-rail'}
                  {@const groupName = resolveGroupDisplayName(
                    groupDisplayNameById,
                    col.groupId,
                  )}
                  {@const groupToggleLabel = i18n.t(
                    col.enabled ? 'group.disable' : 'group.enable',
                    { name: groupName },
                  )}
                  <div class="group-rail-controls">
                    <input
                      class="group-enabled-toggle round-checkbox"
                      type="checkbox"
                      checked={col.enabled}
                      aria-label={groupToggleLabel}
                      use:hint={groupToggleLabel}
                      onpointerdown={(event) => controller.handleGroupTogglePointerDown(event)}
                      onclick={(event) => controller.handleGroupToggleClick(event)}
                      onchange={(event) => controller.handleGroupEnabledChange(event, col.groupId)}
                    />
                    <button
                      class="preset-save-button"
                      type="button"
                      aria-label={i18n.t('group.save', { name: groupName })}
                      use:hint={i18n.t('group.save', { name: groupName })}
                      onpointerdown={(event) => controller.handleGroupSavePointerDown(event)}
                      onclick={(event) => controller.handleGroupSaveClick(event, col.groupId)}
                      oncontextmenu={(event) => controller.handleGroupSaveContextMenu(event)}
                    >
                      <span class="material-symbols-rounded" aria-hidden="true">save</span>
                    </button>
                  </div>
                  <span class="group-label">{groupName}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/each}
  </div>
  <div class="drop-indicator-layer" aria-hidden="true">
    <div
      bind:this={dropIndicatorEl}
      class="drop-indicator"
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
  class="browser-drag-badge app-hint"
  aria-hidden="true"
  hidden
>
  <span
    class="browser-drag-badge-icon browser-entry-icon material-symbols-rounded"
    aria-hidden="true"
  ></span>
  <span class="browser-drag-badge-label"></span>
</div>

<style lang="scss">
  .device-rack {
    --drop-indicator-edge-room: calc(var(--gap-4) + 1px);

    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    height: 100%;
    padding: var(--gap-10);

    .chain-devices {
      position: relative;
      display: flex;
      gap: var(--gap-8);
      height: 100%;
      overflow: auto;
      border-radius: var(--radius-8);
    }

    .rack-empty-message {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      color: var(--color-text-secondary);
      font-size: var(--text-13);
      white-space: nowrap;
      pointer-events: none;
    }
  }

  .device-group {
    position: relative;
    display: flex;
    flex: 0 0 auto;
    height: 100%;
  }

  .device-group.is-rack {
    background: var(--color-surface);
    border: 1px solid var(--color-border-tertiary);
    border-radius: var(--radius-8);
  }

  .device-group.is-rack.is-selected {
    border-color: var(--color-border-secondary);
  }

  .device-group.is-rack.is-selected .group-rail-left,
  .device-group.is-rack.is-selected .group-rail-right {
    background: var(--color-surface-interactive);
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
    --device-card-radius: 0;
    border-radius: 0;
    border: 0;
  }

  .device-group.is-rack .device-group-body > .device-slot + .device-slot :global(.device-card) {
    border-left: 1px solid var(--group-device-divider-color, var(--color-border-tertiary));
  }

  .device-group.is-rack .device-slot.is-selected :global(.device-card),
  .device-group.is-rack .device-slot.is-selected + .device-slot :global(.device-card) {
    --group-device-divider-color: var(--color-border-secondary);
  }
  .device-slot {
    position: relative;
    display: flex;
    flex: 0 0 auto;
  }

  .device-slot--solo {
    height: 100%;
  }

  .drop-indicator-layer {
    position: absolute;
    top: var(--gap-10);
    right: calc(var(--gap-10) - var(--drop-indicator-edge-room));
    bottom: var(--gap-10);
    left: calc(var(--gap-10) - var(--drop-indicator-edge-room));
    overflow: hidden;
    pointer-events: none;
    z-index: var(--z-layer-drag-indicator);
  }

  .drop-indicator {
    position: absolute;
    top: 6px;
    bottom: 6px;
    width: 2px;
    transform: translateX(-1px);
    background: var(--color-surface-inverse);
    border-radius: 1px;
  }

  .group-rail {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--gap-10) var(--gap-6);
    gap: var(--gap-12);
    background: var(--color-surface);
    cursor: grab;
    -webkit-user-drag: none;

    &.is-renaming {
      cursor: default;
    }

    &-controls {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--gap-6);
      flex: 0 0 auto;
    }

    &-left {
      min-width: 2rem;
      border-right: 1px solid var(--color-border-tertiary);
      border-top-left-radius: var(--radius-8);
      border-bottom-left-radius: var(--radius-8);

      &.is-selected {
        border-right-color: var(--color-border-secondary);
      }
    }

    &-right {
      min-width: 0.75rem;
      border-left: 1px solid var(--color-border-tertiary);
      border-top-right-radius: var(--radius-8);
      border-bottom-right-radius: var(--radius-8);

      &.is-selected {
        border-left-color: var(--color-border-secondary);
      }
    }
  }

  .device-group:global(.is-dragging) .group-rail {
    cursor: grabbing;
  }

  .group-label {
    writing-mode: sideways-lr;
    font-size: var(--text-12);
    line-height: 1.2;
    pointer-events: none;
  }

  .group-enabled-toggle {
    width: var(--gap-14);
    height: var(--gap-14);
    flex: 0 0 auto;
  }

  .browser-drag-badge {
    transform: translate3d(-9999px, -9999px, 0);
    opacity: 0;
    display: flex;
    align-items: center;

    :global(.browser-drag-badge-icon) {
      flex: 0 0 auto;
      margin-right: var(--gap-4);
    }
  }

  .browser-drag-badge:global(.is-visible) {
    opacity: 1;
  }
</style>
