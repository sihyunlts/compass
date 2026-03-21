<script lang="ts">
  /**
   * Renders the rack surface and translates pointer/drag interactions into commit events.
   * Integrates rack selection, drop indicators, and group rendering state.
   */
  import { onMount, tick } from 'svelte';
  import { clamp } from '../../shared/math';
  import type { GeneratorDeviceNode, GeneratorChain } from '../../shared/model';
  import type { ContextMenuTarget } from './context-menu-types';
  import type {
    BrowserInsertSource,
    BrowserPresetInsertSource,
    RackInteractionCommit,
    RackPresetFileDrop,
    RackScrollMetrics,
  } from './device-rack-types';
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
  import type { RackDropZone } from '../features/rack/drop-ops';
  import { createRackViewApi, type RackViewApi } from '../features/rack/api';
  import {
    buildDeviceDisplayNameById,
    buildGroupDisplayNameById,
  } from '../features/rack/display-names';
  import {
    attachFloatingLayerDismissHandlers,
    resolveAdjacentFloatingLayerPosition,
  } from '../features/rack/floating-layer';
  import { RackInteractionManager } from '../features/rack/interaction-manager';
  import {
    isRenamingDevice,
    isRenamingGroup,
    resolveCommittedRenameDraft,
    resolveDeviceDisplayName,
    resolveDeviceRenameValue,
    resolveEditableDeviceName,
    resolveEditableGroupName,
    resolveGroupDisplayName,
    resolveRenamePopoverTarget,
    type RackRenameTarget,
  } from '../features/rack/rename';
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

  const rackSelection = createRackSelection();
  let rackInteractionManager = $state<RackInteractionManager | null>(null);
  let rackDragController = $state<RackDragController | null>(null);
  let dropIndicator = $state<RackDropIndicator | null>(null);
  let activeDragInfo = $state<ActiveDragInfo | null>(null);
  let suppressDeviceSelectionClick = false;
  let externalFileDragDepth = 0;
  let resizeObserver: ResizeObserver | null = null;
  let resizeSyncFrameId: number | null = null;
  let lastScrollMetricsSignature: string | null = null;
  let lastMiniMapLayoutSignature: string | null = null;
  let miniMapContentRevision = 0;
  let renameTarget = $state<RackRenameTarget | null>(null);
  let renameDraft = $state('');
  let renamePopover = $state<ReturnType<typeof RackRenamePopover> | null>(null);
  let renamePopoverPosition = $state<{ x: number; y: number } | null>(null);
  let skipRenameBlur = false;
  const RENAME_POPOVER_GAP_PX = 8;
  const RENAME_POPOVER_FALLBACK_WIDTH_PX = 164;
  const RENAME_POPOVER_FALLBACK_HEIGHT_PX = 42;

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
  const deviceDisplayNameById = $derived.by(() => buildDeviceDisplayNameById(devices));
  const groupDisplayNameById = $derived.by(() =>
    buildGroupDisplayNameById(devices, chainState.groupStateById));

  const rackContentItems = $derived.by(() =>
    buildRackContentItems(devices, resolveGroupEnabled));

  const collapsedSet = $derived.by(() => new Set<string>(collapsedDeviceIds));
  const renamePopoverTarget = $derived.by(() =>
    resolveRenamePopoverTarget(renameTarget, collapsedSet));

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
          ? `d:${item.device.id}:${resolveDeviceDisplayName(deviceDisplayNameById, item.device.id)}`
          : `g:${item.groupId}:${resolveGroupDisplayName(groupDisplayNameById, item.groupId)}:${item.enabled ? '1' : '0'}:${item.devices.map((device) => device.id).join(',')}`)
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

  const isFileDragEvent = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');

  const syncExternalFileDropIndicator = (
    clientX: number,
    clientY: number,
  ): RackDropZone | null => {
    const dropZone = rackDragController?.resolveExternalFileDropZone(clientX, clientY) ?? null;
    dropIndicator?.sync({
      didMove: true,
      dropZone,
    });
    return dropZone;
  };

  const getOrderedSelectedDeviceIdsInRack = (): string[] =>
    rackSelection.getOrderedSelectedDeviceIds(orderedDeviceIds);

  const isAdditiveSelection = (event: { metaKey: boolean; ctrlKey: boolean }): boolean =>
    event.metaKey || event.ctrlKey;

  const blurActiveTextEditingElement = (): void => {
    blurIfTextEditingElement(document.activeElement);
  };

  const consumeSuppressedDeviceSelectionClick = (): boolean => {
    if (!suppressDeviceSelectionClick) {
      return false;
    }

    suppressDeviceSelectionClick = false;
    return true;
  };

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
    source: BrowserInsertSource,
    itemEl: HTMLElement,
    badgeLabel: string,
  ) {
    if (!rackDragController) return false;

    const started = rackDragController.startBrowserDrag(
      sourceEvent,
      source,
      itemEl,
      badgeLabel,
    );

    if (started) {
      clearDropIndicator();
      sourceEvent.preventDefault();
    }

    return started;
  }

  const clearRenameState = (): void => {
    renameTarget = null;
    renameDraft = '';
    renamePopover = null;
    renamePopoverPosition = null;
  };

  const releaseRenameBlurGuard = (): void => {
    window.setTimeout(() => {
      skipRenameBlur = false;
    }, 0);
  };

  const focusRenameInput = (): void => {
    void tick().then(() => {
      renamePopover?.focusSelect();
    });
  };

  const resolveRenamePopoverAnchor = (target: RackRenameTarget): HTMLElement | null => {
    if (!chainDevicesEl) {
      return null;
    }

    return target.kind === 'device'
      ? chainDevicesEl.querySelector<HTMLElement>(
        `.device-card[data-device-id="${target.id}"] .device-head`,
      )
      : chainDevicesEl.querySelector<HTMLElement>(
        `.device-group[data-group-id="${target.id}"] .group-rail-left`,
      );
  };

  const resolveRenamePopoverLabel = (target: RackRenameTarget): string => target.kind === 'device'
    ? resolveDeviceDisplayName(deviceDisplayNameById, target.id)
    : resolveGroupDisplayName(groupDisplayNameById, target.id);

  const syncRenamePopoverPosition = (target: RackRenameTarget | null = renamePopoverTarget): void => {
    if (!target) {
      renamePopoverPosition = null;
      return;
    }

    const anchor = resolveRenamePopoverAnchor(target);
    if (!anchor) {
      renamePopoverPosition = null;
      return;
    }

    const anchorRect = anchor.getBoundingClientRect();
    const popoverSize = renamePopover?.measure();
    renamePopoverPosition = resolveAdjacentFloatingLayerPosition(anchorRect, {
      width: popoverSize?.width || RENAME_POPOVER_FALLBACK_WIDTH_PX,
      height: popoverSize?.height || RENAME_POPOVER_FALLBACK_HEIGHT_PX,
    }, {
      gapPx: RENAME_POPOVER_GAP_PX,
    });
  };

  const queueRenamePopoverPositionSync = (target: RackRenameTarget | null = renamePopoverTarget): void => {
    if (!target) {
      renamePopoverPosition = null;
      return;
    }

    void tick().then(() => {
      syncRenamePopoverPosition(target);
    });
  };

  const commitRename = (): boolean => {
    if (!renameTarget) {
      return false;
    }

    skipRenameBlur = true;
    const committedDraft = resolveCommittedRenameDraft({
      renameTarget,
      renameDraft,
      devices,
      groupStateById: chainState.groupStateById,
      deviceDisplayNameById,
    });
    const didRename = renameTarget.kind === 'device'
      ? onRenameDevice(renameTarget.id, committedDraft)
      : onRenameGroup(renameTarget.id, committedDraft);
    clearRenameState();
    releaseRenameBlurGuard();
    return didRename;
  };

  const cancelRename = (): void => {
    if (!renameTarget) {
      return;
    }

    skipRenameBlur = true;
    clearRenameState();
    releaseRenameBlurGuard();
  };

  const openRenameEditor = (
    target: RackRenameTarget,
    nextDraft: string,
  ): boolean => {
    if (renameTarget?.kind === target.kind && renameTarget.id === target.id && renameDraft === nextDraft) {
      focusRenameInput();
      return true;
    }

    if (renameTarget) {
      commitRename();
    }

    renameTarget = target;
    renameDraft = nextDraft;
    onCloseContextMenu();
    syncRenamePopoverPosition(resolveRenamePopoverTarget(target, collapsedSet));
    focusRenameInput();
    return true;
  };

  const startRenamingDevice = (deviceId: string): boolean => {
    const device = devices.find((item: GeneratorDeviceNode) => item.id === deviceId);
    if (!device) {
      return false;
    }

    return openRenameEditor(
      { kind: 'device', id: deviceId },
      resolveEditableDeviceName(device, deviceDisplayNameById),
    );
  };

  const startRenamingGroup = (groupId: string): boolean => {
    if (!orderedGroupIds.includes(groupId)) {
      return false;
    }

    return openRenameEditor(
      { kind: 'group', id: groupId },
      resolveEditableGroupName(groupId, chainState.groupStateById),
    );
  };

  const rackViewApi: RackViewApi = createRackViewApi({
    rackSelection,
    getDevices: () => devices,
    getOrderedDeviceIds: () => orderedDeviceIds,
    getOrderedGroupIds: () => orderedGroupIds,
    syncAfterRender,
    startRenamingDevice,
    startRenamingGroup,
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

  function handleRenameInput(event: Event) {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    renameDraft = target.value;
  }

  function handleRenameInputBlur() {
    if (skipRenameBlur) {
      return;
    }

    commitRename();
  }

  function handleRenameInputKeyDown(event: KeyboardEvent) {
    event.stopPropagation();

    if (event.key === 'Enter') {
      event.preventDefault();
      commitRename();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      cancelRename();
    }
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
    if (consumeSuppressedDeviceSelectionClick()) {
      return;
    }

    if (rackInteractionManager?.handleControlClick(event)) {
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
    if (renamePopoverTarget) {
      syncRenamePopoverPosition();
    }
  }

  function handleDragStart(event: DragEvent) {
    event.preventDefault();
  }

  function handleChainDragEnter(event: DragEvent) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    const isInitialEnter = externalFileDragDepth === 0;
    externalFileDragDepth += 1;
    if (isInitialEnter) {
      onCloseContextMenu();
    }
    syncExternalFileDropIndicator(event.clientX, event.clientY);
  }

  function handleChainDragOver(event: DragEvent) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    syncExternalFileDropIndicator(event.clientX, event.clientY);
  }

  function handleChainDragLeave(event: DragEvent) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    externalFileDragDepth = Math.max(0, externalFileDragDepth - 1);
    if (externalFileDragDepth === 0) {
      clearDropIndicator();
    }
  }

  async function handleChainDrop(event: DragEvent) {
    if (!isFileDragEvent(event)) {
      return;
    }

    event.preventDefault();
    onCloseContextMenu();

    const files = Array.from(event.dataTransfer?.files ?? []);
    const file = files[0] ?? null;
    const dropZone = syncExternalFileDropIndicator(
      event.clientX,
      event.clientY,
    );
    externalFileDragDepth = 0;
    clearDropIndicator();

    if (!file) {
      return;
    }

    await onPresetFileDrop({
      file,
      fileCount: files.length,
      dropZone,
    });
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
      if (pointerResult.source.kind === 'device-kind') {
        onCommit({
          kind: 'insert-device',
          deviceKind: pointerResult.source.deviceKind,
          dropZone: pointerResult.dropZone,
        });
        return;
      }

      onPresetInsertDrop(pointerResult.source, pointerResult.dropZone);
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
    if (!renameTarget) {
      renamePopoverPosition = null;
      return;
    }

    const targetExists = renameTarget.kind === 'device'
      ? devices.some((device: GeneratorDeviceNode) => device.id === renameTarget.id)
      : orderedGroupIds.includes(renameTarget.id);

    if (!targetExists) {
      clearRenameState();
    }
  });

  $effect(() => {
    if (!renamePopoverTarget) {
      renamePopoverPosition = null;
      return;
    }

    queueRenamePopoverPositionSync();
  });

  $effect(() => {
    onRackApiReady(rackViewApi);

    return () => {
      onRackApiReady(null);
    };
  });

  onMount(() =>
    attachFloatingLayerDismissHandlers({
      isActive: () => renamePopoverTarget !== null,
      containsEventTarget: (eventTarget) => renamePopover?.containsTarget(eventTarget) ?? false,
      onPointerDownOutside: () => {
        commitRename();
      },
      onResize: () => {
        commitRename();
      },
    }));

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
            isRenaming={isRenamingDevice(renameTarget, item.device.id)}
            renameValue={resolveDeviceRenameValue(renameTarget, renameDraft, item.device.id)}
            onRenameInput={handleRenameInput}
            onRenameBlur={handleRenameInputBlur}
            onRenameKeyDown={handleRenameInputKeyDown}
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
                class:is-renaming={col.kind === 'left-rail' && isRenamingGroup(renameTarget, col.groupId)}
                onpointerdown={col.kind === 'device'
                  ? undefined
                  : isRenamingGroup(renameTarget, col.groupId)
                    ? undefined
                  : (event) => handleGroupRailPointerDown(event, col.groupId)}
                onclick={col.kind === 'device'
                  ? undefined
                  : isRenamingGroup(renameTarget, col.groupId)
                    ? undefined
                  : handleGroupRailClick}
                oncontextmenu={col.kind === 'device'
                  ? undefined
                  : isRenamingGroup(renameTarget, col.groupId)
                    ? undefined
                  : (event) => handleGroupRailContextMenu(event, col.groupId)}
                ondblclick={col.kind === 'device'
                  ? undefined
                  : isRenamingGroup(renameTarget, col.groupId)
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
                    isRenaming={isRenamingDevice(renameTarget, col.device.id)}
                    renameValue={resolveDeviceRenameValue(renameTarget, renameDraft, col.device.id)}
                    onRenameInput={handleRenameInput}
                    onRenameBlur={handleRenameInputBlur}
                    onRenameKeyDown={handleRenameInputKeyDown}
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

{#if renamePopoverTarget && renamePopoverPosition}
  <RackRenamePopover
    bind:this={renamePopover}
    x={renamePopoverPosition.x}
    y={renamePopoverPosition.y}
    value={renameDraft}
    ariaLabel={`Rename ${resolveRenamePopoverLabel(renamePopoverTarget)}`}
    onInput={handleRenameInput}
    onBlur={handleRenameInputBlur}
    onKeyDown={handleRenameInputKeyDown}
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
