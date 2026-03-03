<script lang="ts">
  /**
   * Main renderer composition root.
   * Coordinates persisted state, rack interactions, preview/playback, and IPC updates.
   */
  import { onMount, tick } from 'svelte';

  import type {
    BridgeSettings,
    BridgeTarget,
    GenerateAndSendRequest,
    GeneratorChain,
    GeneratorDeviceNode,
    GeneratorPreview,
    LaunchpadModel,
    PaletteFilePayload,
    PreviewWindowState,
  } from '../shared/types';
  import { normalizeOptionalId } from '../shared/normalize-id';
  import {
    AUTO_CREATE_LENGTH_OPTIONS,
    parseBeatsValue,
    toLengthPresetLabel,
  } from '../shared/beat-length';
  import {
    PREVIEW_FRAME_COUNT,
    toPreviewFrameBeat,
    toPreviewFrameIndex,
  } from './services/preview-cache';
  import {
    type CompiledModulationProgram,
    compileModulationProgram,
    evaluateModulationProgramReadouts,
  } from '../core/modulation/compiled-program';
  import {
    reconcileGeneratorChainModulators,
  } from '../core/modulation/routing';
  import { clamp } from '../shared/math';
  import {
    createDeviceNodeByKind,
    getBrowserDeviceLabel,
    isBrowserDeviceKind,
    type BrowserDeviceKind,
  } from './services/devices';
  import {
    saveChainSettings,
    saveBridgeSettings,
    loadCollapsedDeviceIds,
    saveCollapsedDeviceIds,
    saveLaunchpadModel,
    savePreviewBpm,
    savePreviewGuideEnabled,
    savePreviewLoopEnabled,
    saveSidebarWidth,
    sanitizeBridgeSettings,
    sanitizePreviewBpm,
    sanitizeSidebarWidth,
  } from './services/storage';
  import {
    reconcileGroupStateById,
    removeDevicesById,
    withDevices,
  } from './state/chain';
  import {
    createChainHistory,
    type ChainMutationMeta,
  } from './state/chain-history';
  import type { ContextMenuTarget } from './state/context-menu';
  import {
    applyInsertDeviceByDropZone,
    applyInsertDevicesByDropZone,
    applyMoveDevicesByDropZone,
    coerceOutsideTargetIdToGroupBoundaryByDevices,
    type RackDropZone,
  } from './state/rack-drop';
  import BrowserPanel from './components/BrowserPanel.svelte';
  import SidebarResizer from './components/SidebarResizer.svelte';
  import DeviceRack, { type RackInteractionCommit } from './components/DeviceRack.svelte';
  import PreviewPanel from './components/PreviewPanel.svelte';
  import ContextMenu from './components/ContextMenu.svelte';
  import { generateRendererPreview } from './app/preview';
  import {
    createInitialAppState,
    type AppState,
  } from './app/store';
  import { createPaletteController } from './services/palette';
  import {
    collectActiveVelocityByPitch,
    createPlaybackScheduler,
    createPreviewWindowStatePusher,
  } from './services/playback';
  import { cloneChainForIpc } from './services/clone-chain';
  import {
    createRackClipboard,
    prepareClipboardInsert,
    type RackClipboard,
  } from './services/rack-clipboard';

  const SCRUB_MAX = 1000;
  const PREVIEW_WINDOW_STATE_MAX_FPS = 120;
  const PREVIEW_WINDOW_STATE_MIN_INTERVAL_MS = Math.round(
    1000 / PREVIEW_WINDOW_STATE_MAX_FPS,
  );
  const AUTO_PREVIEW_DEBOUNCE_MS = 120;
  const HISTORY_MAX_ENTRIES = 100;
  const SEND_DONE_MS = 900;
  const DEFAULT_LED_RGB = '255 166 57';
  const INTERACTIVE_ELEMENT_SELECTOR = 'button, input, select, textarea, option';
  const NON_TEXT_INPUT_TYPES = new Set([
    'checkbox',
    'radio',
    'range',
    'button',
    'submit',
    'reset',
  ]);

  const toBpmText = (bpm: number): string =>
    `BPM ${sanitizePreviewBpm(bpm).toFixed(2)}`;

  const isTextEditingElement = (element: Element | null): boolean => {
    if (!element) {
      return false;
    }

    if (
      element instanceof HTMLTextAreaElement
      || element instanceof HTMLSelectElement
      || (element instanceof HTMLElement && element.isContentEditable)
    ) {
      return true;
    }

    if (element instanceof HTMLInputElement) {
      const type = element.type.toLowerCase();
      return !NON_TEXT_INPUT_TYPES.has(type);
    }

    return false;
  };

  const toBrowserDragBadgeLabel = (kind: BrowserDeviceKind): string =>
    `+ ${getBrowserDeviceLabel(kind)}`;

  const readBridgeSettingsFromLabel = (lengthLabel: string): BridgeSettings =>
    sanitizeBridgeSettings({
      autoCreateLengthBeats: parseBeatsValue(lengthLabel),
    });

  const resolveBridgeLengthLabel = (bridge: BridgeSettings): string =>
    toLengthPresetLabel(bridge.autoCreateLengthBeats, AUTO_CREATE_LENGTH_OPTIONS[0].label);

  const bridgeClient = window.compass;
  const uiState: AppState = $state(createInitialAppState());
  const paletteController = createPaletteController({
    onPaletteNameChanged: (nameText) => {
      uiState.paletteNameText = nameText;
    },
  });
  const previewWindowStatePusher = createPreviewWindowStatePusher({
    bridgeClient,
    minIntervalMs: PREVIEW_WINDOW_STATE_MIN_INTERVAL_MS,
    resolveLedRgb: (velocity) => paletteController.getLedRgb(velocity, DEFAULT_LED_RGB),
  });

  let deviceRackComponent: ReturnType<typeof DeviceRack> | null = $state(null);
  let playbackScheduler: ReturnType<typeof createPlaybackScheduler> | null = null;
  let contextMenuComponent: ReturnType<typeof ContextMenu> | null = $state(null);
  let previewSurfaceState: PreviewWindowState | null = $state(null);

  let previewRevision = $state(0);
  let previewData: GeneratorPreview | null = $state(null);
  let previewSourceChain: GeneratorChain | null = null;
  let previewLedFrameCache: ReadonlyArray<ReadonlyMap<number, number>> | null = $state(null);
  let compiledProgramCache:
    | {
        chainRef: GeneratorChain;
        program: CompiledModulationProgram;
        modulatorIds: readonly string[];
      }
    | null = null;
  let modulationReadoutById: Record<string, string> = $state({});
  let currentBeat = $state(0);
  let isPlaying = $state(false);
  let collapsedDeviceIds = $state(loadCollapsedDeviceIds());
  let autoPreviewTimer: number | null = null;
  let sendDoneTimer: number | null = null;
  let liveTempoUnsubscribe: (() => void) | null = null;
  let previewWindowVisibilityUnsubscribe: (() => void) | null = null;
  let previewGuideEnabledUnsubscribe: (() => void) | null = null;
  let rackClipboard: RackClipboard | null = $state(null);

  type RackSelectionSnapshot =
    | {
        kind: 'devices';
        deviceIds: string[];
      }
    | {
        kind: 'group';
        groupId: string;
        memberDeviceIds: string[];
      };

  const HISTORY_META = {
    addDevice: { kind: 'add-device', label: 'Add device' },
    insertDevice: { kind: 'insert-device', label: 'Insert device' },
    moveDevices: { kind: 'move-devices', label: 'Move devices' },
    deleteDevices: { kind: 'delete-devices', label: 'Delete devices' },
    groupCreate: { kind: 'group-create', label: 'Create group' },
    groupUngroup: { kind: 'group-ungroup', label: 'Ungroup devices' },
    groupToggleEnabled: { kind: 'group-toggle-enabled', label: 'Toggle group enabled' },
    clipboardCut: { kind: 'clipboard-cut', label: 'Cut selection' },
    clipboardPaste: { kind: 'clipboard-paste', label: 'Paste selection' },
    duplicate: { kind: 'duplicate', label: 'Duplicate selection' },
  } as const satisfies Record<string, ChainMutationMeta>;

  const chainHistory = createChainHistory(uiState.chainState, {
    maxEntries: HISTORY_MAX_ENTRIES,
  });
  let canUndo = $state(chainHistory.canUndo());
  let canRedo = $state(chainHistory.canRedo());
  let undoActionLabel = $state(chainHistory.getUndoEntry()?.label ?? 'Undo');
  let redoActionLabel = $state(chainHistory.getRedoEntry()?.label ?? 'Redo');

  const syncHistoryUiState = (): void => {
    canUndo = chainHistory.canUndo();
    canRedo = chainHistory.canRedo();
    undoActionLabel = chainHistory.getUndoEntry()?.label ?? 'Undo';
    redoActionLabel = chainHistory.getRedoEntry()?.label ?? 'Redo';
  };

  const persistChainState = (): void => {
    reconcileCurrentChainModulators();
    pruneCollapsedDeviceIds();
    saveChainSettings(uiState.chainState);
    void syncRackAfterRender();
  };

  const onChainMutated = (meta: ChainMutationMeta): void => {
    persistChainState();
    chainHistory.push(uiState.chainState, meta);
    syncHistoryUiState();
  };

  const restoreChainFromHistory = (chain: GeneratorChain): void => {
    uiState.chainState = chain;
    persistChainState();
    chainHistory.replaceCurrent(uiState.chainState);
    scheduleAutoPreview(0);
  };

  const handleUndo = (): boolean => {
    const restored = chainHistory.undo();
    syncHistoryUiState();
    if (!restored) {
      return false;
    }
    restoreChainFromHistory(restored);
    return true;
  };

  const handleRedo = (): boolean => {
    const restored = chainHistory.redo();
    syncHistoryUiState();
    if (!restored) {
      return false;
    }
    restoreChainFromHistory(restored);
    return true;
  };

  const handleUndoClick = (): void => {
    contextMenuComponent?.close();
    handleUndo();
  };

  const handleRedoClick = (): void => {
    contextMenuComponent?.close();
    handleRedo();
  };

  const reconcileCurrentChainModulators = (): void => {
    const changed = reconcileGeneratorChainModulators(uiState.chainState);
    if (changed) {
      uiState.chainState = withDevices(
        uiState.chainState,
        [...uiState.chainState.devices],
      );
    }
  };

  const pruneCollapsedDeviceIds = (): void => {
    const validIds = new Set(
      uiState.chainState.devices.map((device: GeneratorDeviceNode) => device.id),
    );
    const next = collapsedDeviceIds.filter((id) => validIds.has(id));
    if (next.length === collapsedDeviceIds.length) {
      return;
    }
    collapsedDeviceIds = next;
    saveCollapsedDeviceIds(next);
  };

  const toggleCollapse = (id: string): void => {
    const next = collapsedDeviceIds.includes(id)
      ? collapsedDeviceIds.filter((item) => item !== id)
      : [...collapsedDeviceIds, id];
    collapsedDeviceIds = next;
    saveCollapsedDeviceIds(next);
  };

  const syncRackAfterRender = async (): Promise<void> => {
    await tick();
    deviceRackComponent?.syncAfterRender();
    contextMenuComponent?.close();
  };

  pruneCollapsedDeviceIds();

  const scheduleAutoPreview = (delayMs = AUTO_PREVIEW_DEBOUNCE_MS): void => {
    if (autoPreviewTimer !== null) {
      window.clearTimeout(autoPreviewTimer);
    }

    autoPreviewTimer = window.setTimeout(() => {
      autoPreviewTimer = null;
      void runPreview();
    }, delayMs);
  };

  const deleteDevicesById = (
    deviceIds: readonly string[],
    meta: ChainMutationMeta = HISTORY_META.deleteDevices,
  ): boolean => {
    deviceRackComponent?.applyNextSelectionAfterDelete(deviceIds);

    const nextChain = removeDevicesById(uiState.chainState, deviceIds);
    if (!nextChain) {
      return false;
    }

    uiState.chainState = nextChain;
    onChainMutated(meta);
    scheduleAutoPreview(0);
    return true;
  };

  const getNextGroupId = (): string => {
    const existing = new Set(
      uiState.chainState.devices
        .map((device) => normalizeOptionalId(device.groupId))
        .filter((value): value is string => value !== null),
    );
    let index = 1;
    while (existing.has(`group-${index}`)) {
      index += 1;
    }
    return `group-${index}`;
  };

  const setGroupIdForDevices = (
    deviceIds: readonly string[],
    groupId: string | null,
    meta: ChainMutationMeta,
  ): boolean => {
    const idSet = new Set(deviceIds);
    if (idSet.size === 0) {
      return false;
    }

    let didChange = false;
    const nextDevices = uiState.chainState.devices.map((device) => {
      if (!idSet.has(device.id)) {
        return device;
      }
      const nextGroupId = groupId ?? null;
      const currentGroupId = device.groupId ?? null;
      if (currentGroupId === nextGroupId) {
        return device;
      }
      didChange = true;
      return {
        ...device,
        groupId: nextGroupId,
      };
    });

    if (!didChange) {
      return false;
    }

    uiState.chainState = withDevices(uiState.chainState, nextDevices);
    onChainMutated(meta);
    scheduleAutoPreview(0);
    return true;
  };

  const canCreateGroupFromSelection = (deviceIds: readonly string[]): boolean =>
    deviceIds.length > 0 && deviceIds.every((id) => {
      const device = uiState.chainState.devices.find((item) => item.id === id);
      return !normalizeOptionalId(device?.groupId ?? null);
    });

  const getGroupMemberIds = (rawGroupId: string): string[] => {
    const groupId = normalizeOptionalId(rawGroupId);
    if (!groupId) {
      return [];
    }

    return uiState.chainState.devices
      .filter((device) => normalizeOptionalId(device.groupId) === groupId)
      .map((device) => device.id);
  };

  const withGroupMemberIds = (
    rawGroupId: string,
    action: (memberIds: string[]) => boolean,
  ): boolean => {
    const memberIds = getGroupMemberIds(rawGroupId);
    if (memberIds.length === 0) {
      return false;
    }
    return action(memberIds);
  };

  const deleteGroup = (
    rawGroupId: string,
    meta: ChainMutationMeta = HISTORY_META.deleteDevices,
  ): boolean =>
    withGroupMemberIds(rawGroupId, (memberIds) => deleteDevicesById(memberIds, meta));

  const ungroupGroup = (
    rawGroupId: string,
    meta: ChainMutationMeta = HISTORY_META.groupUngroup,
  ): boolean => {
    return withGroupMemberIds(
      rawGroupId,
      (memberIds) => setGroupIdForDevices(memberIds, null, meta),
    );
  };

  const toExistingOrderedDeviceIds = (deviceIds: readonly string[]): string[] => {
    const idSet = new Set(deviceIds);
    return uiState.chainState.devices
      .filter((device) => idSet.has(device.id))
      .map((device) => device.id);
  };

  const resolveDevicesByIds = (deviceIds: readonly string[]): GeneratorDeviceNode[] => {
    if (deviceIds.length === 0) {
      return [];
    }

    const byId = new Map(
      uiState.chainState.devices.map((device): [string, GeneratorDeviceNode] => [device.id, device]),
    );
    const resolved: GeneratorDeviceNode[] = [];
    for (const id of deviceIds) {
      const device = byId.get(id);
      if (device) {
        resolved.push(device);
      }
    }
    return resolved;
  };

  type SelectionLike =
    | {
        kind: 'devices';
        deviceIds: readonly string[];
      }
    | {
        kind: 'group';
        groupId: string;
        memberDeviceIds: readonly string[];
      };

  const toSelectionSnapshot = (source: SelectionLike): RackSelectionSnapshot | null => {
    if (source.kind === 'group') {
      const memberDeviceIds = toExistingOrderedDeviceIds(source.memberDeviceIds);
      if (memberDeviceIds.length === 0) {
        return null;
      }
      return {
        kind: 'group',
        groupId: source.groupId,
        memberDeviceIds,
      };
    }

    const deviceIds = toExistingOrderedDeviceIds(source.deviceIds);
    if (deviceIds.length === 0) {
      return null;
    }
    return {
      kind: 'devices',
      deviceIds,
    };
  };

  const resolveCurrentSelectionSnapshot = (): RackSelectionSnapshot | null => {
    const selectedGroups = deviceRackComponent?.getSelectedGroupContexts() ?? [];
    const selectedGroup = selectedGroups[0] ?? null;
    if (selectedGroup && selectedGroups.length === 1) {
      return toSelectionSnapshot({
        kind: 'group',
        groupId: selectedGroup.groupId,
        memberDeviceIds: selectedGroup.memberDeviceIds,
      });
    }

    return toSelectionSnapshot({
      kind: 'devices',
      deviceIds: deviceRackComponent?.getOrderedSelectedDeviceIds() ?? [],
    });
  };

  const resolveSelectionSnapshotFromContextTarget = (
    target: ContextMenuTarget,
  ): RackSelectionSnapshot | null =>
    target.kind === 'group'
      ? toSelectionSnapshot({
          kind: 'group',
          groupId: target.groupId,
          memberDeviceIds: target.memberDeviceIds,
        })
      : toSelectionSnapshot({
          kind: 'devices',
          deviceIds: target.deviceIds,
        });

  const resolveActionSelection = (
    selectionOverride?: RackSelectionSnapshot | null,
  ): RackSelectionSnapshot | null => selectionOverride ?? resolveCurrentSelectionSnapshot();

  const buildClipboardFromSelection = (
    selection: RackSelectionSnapshot,
  ): RackClipboard | null => {
    const sourceIds = selection.kind === 'group'
      ? selection.memberDeviceIds
      : selection.deviceIds;
    const sourceDevices = resolveDevicesByIds(sourceIds);

    if (selection.kind === 'group') {
      return createRackClipboard(sourceDevices, {
        kind: 'group',
        enabled: uiState.chainState.groupStateById[selection.groupId]?.enabled !== false,
      });
    }

    return createRackClipboard(sourceDevices, { kind: 'devices' });
  };

  const copySelectionToClipboard = (
    selectionOverride?: RackSelectionSnapshot | null,
  ): RackClipboard | null => {
    const selection = resolveActionSelection(selectionOverride);
    if (!selection) {
      return null;
    }

    const nextClipboard = buildClipboardFromSelection(selection);
    if (!nextClipboard) {
      return null;
    }

    rackClipboard = nextClipboard;
    return nextClipboard;
  };

  const cutSelection = (
    selectionOverride?: RackSelectionSnapshot | null,
  ): boolean => {
    const selection = resolveActionSelection(selectionOverride);
    if (!selection) {
      return false;
    }

    const copied = copySelectionToClipboard(selection);
    if (!copied) {
      return false;
    }

    return selection.kind === 'group'
      ? deleteGroup(selection.groupId, HISTORY_META.clipboardCut)
      : deleteDevicesById(selection.deviceIds, HISTORY_META.clipboardCut);
  };

  const resolveGroupEndTargetId = (
    chain: GeneratorChain,
    rawGroupId: string,
  ): string | null => {
    const groupId = normalizeOptionalId(rawGroupId);
    if (!groupId) {
      return null;
    }

    let lastDeviceId: string | null = null;
    for (const device of chain.devices) {
      if (normalizeOptionalId(device.groupId) === groupId) {
        lastDeviceId = device.id;
      }
    }
    return lastDeviceId;
  };

  const resolveCommonSelectedGroupId = (
    chain: GeneratorChain,
    deviceIds: readonly string[],
  ): string | null => {
    let commonGroupId: string | null | undefined = undefined;
    const byId = new Map(
      chain.devices.map((device): [string, GeneratorDeviceNode] => [device.id, device]),
    );

    for (const deviceId of deviceIds) {
      const device = byId.get(deviceId);
      if (!device) {
        return null;
      }

      const groupId = normalizeOptionalId(device.groupId);
      if (commonGroupId === undefined) {
        commonGroupId = groupId;
        continue;
      }

      if (commonGroupId !== groupId) {
        return null;
      }
    }

    return commonGroupId ?? null;
  };

  const resolvePasteDropZone = (
    chain: GeneratorChain,
    selection: RackSelectionSnapshot | null,
    clipboardKind: RackClipboard['kind'],
  ): RackDropZone => {
    if (clipboardKind === 'group') {
      if (selection?.kind === 'group') {
        return {
          kind: 'outside',
          targetId: resolveGroupEndTargetId(chain, selection.groupId),
          placement: 'after',
        };
      }

      if (selection?.kind === 'devices') {
        const selectedLastId = selection.deviceIds[selection.deviceIds.length - 1] ?? null;
        return {
          kind: 'outside',
          targetId: coerceOutsideTargetIdToGroupBoundaryByDevices(
            chain.devices,
            selectedLastId,
            'after',
          ),
          placement: 'after',
        };
      }

      return {
        kind: 'outside',
        targetId: null,
        placement: 'after',
      };
    }

    if (selection?.kind === 'group') {
      const groupTailId = resolveGroupEndTargetId(chain, selection.groupId);
      if (groupTailId) {
        return {
          kind: 'inside-group',
          groupId: selection.groupId,
          targetId: groupTailId,
          placement: 'after',
        };
      }
    } else if (selection?.kind === 'devices') {
      const selectedLastId = selection.deviceIds[selection.deviceIds.length - 1] ?? null;
      if (selectedLastId) {
        const commonGroupId = resolveCommonSelectedGroupId(chain, selection.deviceIds);
        if (commonGroupId) {
          return {
            kind: 'inside-group',
            groupId: commonGroupId,
            targetId: selectedLastId,
            placement: 'after',
          };
        }

        return {
          kind: 'outside',
          targetId: coerceOutsideTargetIdToGroupBoundaryByDevices(
            chain.devices,
            selectedLastId,
            'after',
          ),
          placement: 'after',
        };
      }
    }

    return {
      kind: 'outside',
      targetId: null,
      placement: 'after',
    };
  };

  const allocateDeviceId = (kind: GeneratorDeviceNode['kind']): string =>
    createDeviceNodeByKind(kind).id;

  const coercePasteDropZone = (
    chain: GeneratorChain,
    dropZone: RackDropZone,
    clipboardKind: RackClipboard['kind'],
  ): RackDropZone => {
    if (clipboardKind !== 'group' || dropZone.kind === 'outside') {
      return dropZone;
    }

    return {
      kind: 'outside',
      targetId: coerceOutsideTargetIdToGroupBoundaryByDevices(
        chain.devices,
        dropZone.targetId,
        dropZone.placement,
      ),
      placement: dropZone.placement,
    };
  };

  const applyChainMutation = (
    nextChain: GeneratorChain,
    meta: ChainMutationMeta,
  ): void => {
    uiState.chainState = nextChain;
    onChainMutated(meta);
    scheduleAutoPreview(0);
  };

  const buildChainWithClipboardPaste = (
    chain: GeneratorChain,
    clipboard: RackClipboard,
    selection: RackSelectionSnapshot | null,
  ): GeneratorChain => {
    const rawDropZone = resolvePasteDropZone(chain, selection, clipboard.kind);
    const dropZone = coercePasteDropZone(chain, rawDropZone, clipboard.kind);
    const prepared = prepareClipboardInsert(clipboard, {
      allocateDeviceId,
      resolveNextGroupId: getNextGroupId,
    });

    const forcedGroupId = prepared.groupStatePatch
      ? prepared.forcedGroupId
      : dropZone.kind === 'inside-group'
        ? dropZone.groupId
        : null;
    const nextDevices = applyInsertDevicesByDropZone(
      chain.devices,
      prepared.devices,
      dropZone,
      forcedGroupId,
    );

    const nextChain = withDevices(chain, nextDevices);
    if (prepared.groupStatePatch) {
      nextChain.groupStateById[prepared.groupStatePatch.groupId] = {
        enabled: prepared.groupStatePatch.enabled,
      };
    }
    return nextChain;
  };

  const pasteClipboard = (
    clipboardOverride?: RackClipboard | null,
    selectionOverride?: RackSelectionSnapshot | null,
    mutationMeta: ChainMutationMeta = HISTORY_META.clipboardPaste,
  ): boolean => {
    const clipboard = clipboardOverride ?? rackClipboard;
    if (!clipboard) {
      return false;
    }

    const selection = resolveActionSelection(selectionOverride);
    const nextChain = buildChainWithClipboardPaste(uiState.chainState, clipboard, selection);
    applyChainMutation(nextChain, mutationMeta);
    return true;
  };

  const duplicateSelection = (
    selectionOverride?: RackSelectionSnapshot | null,
  ): boolean => {
    const selection = resolveActionSelection(selectionOverride);
    if (!selection) {
      return false;
    }

    const copied = copySelectionToClipboard(selection);
    if (!copied) {
      return false;
    }
    return pasteClipboard(copied, selection, HISTORY_META.duplicate);
  };

  const selectAllRackDevices = (): boolean => {
    const ids = uiState.chainState.devices.map((device) => device.id);
    deviceRackComponent?.selectAllDevices(ids);
    return true;
  };

  const handleToggleGroupEnabled = (
    rawGroupId: string,
    nextEnabled: boolean,
  ): void => {
    const groupId = normalizeOptionalId(rawGroupId);
    if (!groupId) {
      return;
    }

    const hasGroup = uiState.chainState.devices.some(
      (device) => normalizeOptionalId(device.groupId) === groupId,
    );
    if (!hasGroup) {
      return;
    }

    const currentEnabled = uiState.chainState.groupStateById[groupId]?.enabled !== false;
    if (currentEnabled === nextEnabled) {
      return;
    }

    const reconciledById = reconcileGroupStateById(
      uiState.chainState.groupStateById,
      uiState.chainState.devices,
    );
    uiState.chainState = {
      ...uiState.chainState,
      groupStateById: {
        ...reconciledById,
        [groupId]: {
          enabled: nextEnabled,
        },
      },
    };
    onChainMutated(HISTORY_META.groupToggleEnabled);
    scheduleAutoPreview(0);
  };

  const readBridge = (): BridgeSettings =>
    readBridgeSettingsFromLabel(uiState.autoCreateLengthLabel);

  const writeBridgeInputs = (bridge: BridgeSettings): void => {
    uiState.autoCreateLengthLabel = resolveBridgeLengthLabel(bridge);
    uiState.previewLoopLengthBeats = bridge.autoCreateLengthBeats;
  };

  const requestLiveTempoSync = async (): Promise<void> => {
    await bridgeClient.requestLiveTempo();
  };

  const runBestEffort = (task: Promise<unknown>): void => {
    void task.catch(() => {
      // Non-critical sync failures should not break the main flow.
    });
  };

  const getPreviewLoopMs = (): number => {
    const bpm = sanitizePreviewBpm(uiState.previewBpm);
    const beats = Math.max(uiState.previewLoopLengthBeats, 0.25);
    return (60000 / bpm) * beats;
  };

  const EMPTY_ACTIVE_VELOCITY_BY_PITCH = new Map<number, number>();
  const EMPTY_MODULATION_READOUT_BY_ID: Readonly<Record<string, string>> = Object.freeze({});

  const buildLedFrameCache = (
    preview: GeneratorPreview,
  ): ReadonlyArray<ReadonlyMap<number, number>> => {
    const frames: Array<ReadonlyMap<number, number>> = [];
    for (let index = 0; index < PREVIEW_FRAME_COUNT; index += 1) {
      frames.push(collectActiveVelocityByPitch(preview, toPreviewFrameBeat(index)));
    }
    return frames;
  };

  const resolveActiveVelocityByPitchAtBeat = (
    beat01: number,
  ): ReadonlyMap<number, number> => {
    if (!previewLedFrameCache || previewLedFrameCache.length === 0) {
      return EMPTY_ACTIVE_VELOCITY_BY_PITCH;
    }
    const frameIndex = toPreviewFrameIndex(beat01);
    return previewLedFrameCache[frameIndex] ?? EMPTY_ACTIVE_VELOCITY_BY_PITCH;
  };

  const toModulationReadoutMap = (
    chain: GeneratorChain,
    beat01: number,
  ): {
    readoutById: Readonly<Record<string, string>>;
  } => {
    if (!compiledProgramCache || compiledProgramCache.chainRef !== chain) {
      const modulatorIds = chain.devices
        .filter((device) => device.kind === 'modulator')
        .map((device) => device.id);
      compiledProgramCache = {
        chainRef: chain,
        program: compileModulationProgram(chain),
        modulatorIds,
      };
    }

    if (compiledProgramCache.modulatorIds.length === 0) {
      return {
        readoutById: EMPTY_MODULATION_READOUT_BY_ID,
      };
    }

    const baseline: Record<string, string> = {};
    for (const modulatorId of compiledProgramCache.modulatorIds) {
      baseline[modulatorId] = 'No valid target';
    }

    const readouts = evaluateModulationProgramReadouts(
      compiledProgramCache.program,
      beat01,
      uiState.previewLoopLengthBeats,
      { wrap: uiState.isPreviewLoopEnabled },
    );
    for (const readout of readouts) {
      baseline[readout.modulatorId] = [
        `${readout.targetParamKey}`,
        `Current ${readout.modulatedValue.toFixed(3)}`,
        `Base ${readout.baseValue.toFixed(3)}`,
      ].join(' | ');
    }

    return {
      readoutById: baseline,
    };
  };

  const renderLedFrame = (): void => {
    const clampedBeat = clamp(currentBeat, 0, 1);
    const sourceChain = previewSourceChain ?? uiState.chainState;
    const modulationRuntime = toModulationReadoutMap(sourceChain, clampedBeat);
    const activeVelocityByPitch = resolveActiveVelocityByPitchAtBeat(clampedBeat);
    modulationReadoutById = modulationRuntime.readoutById;
    const activeCells: PreviewWindowState['activeCells'] = [];
    for (const [pitch, velocity] of activeVelocityByPitch.entries()) {
      activeCells.push({
        pitch,
        rgb: paletteController.getLedRgb(velocity, DEFAULT_LED_RGB),
      });
    }

    previewSurfaceState = {
      activeCells,
      previewRevision,
      launchpadModel: uiState.launchpadModel,
      chain: sourceChain,
      currentBeat: clampedBeat,
      loopLengthBeats: uiState.previewLoopLengthBeats,
      noteCount: previewData?.noteCount ?? 0,
      uniquePitchCount: previewData?.uniquePitchCount ?? 0,
      bpm: uiState.previewBpm,
      isPlaying,
      isLoopEnabled: uiState.isPreviewLoopEnabled,
      isGuideEnabled: uiState.isPreviewGuideEnabled,
    };

    const nextPreviewScrubValue = Math.round(clampedBeat * SCRUB_MAX);
    if (uiState.previewScrubValue !== nextPreviewScrubValue) {
      uiState.previewScrubValue = nextPreviewScrubValue;
    }
    previewWindowStatePusher.push({
      activeVelocityByPitch,
      previewRevision,
      currentBeat: clampedBeat,
      loopLengthBeats: uiState.previewLoopLengthBeats,
      launchpadModel: uiState.launchpadModel,
      noteCount: previewData?.noteCount ?? 0,
      uniquePitchCount: previewData?.uniquePitchCount ?? 0,
      bpm: uiState.previewBpm,
      isPlaying,
      isLoopEnabled: uiState.isPreviewLoopEnabled,
      isGuideEnabled: uiState.isPreviewGuideEnabled,
      resolveChain: () => sourceChain,
    });
  };

  const applyPreviewGuideEnabled = (nextEnabled: boolean): void => {
    if (uiState.isPreviewGuideEnabled === nextEnabled) {
      return;
    }

    uiState.isPreviewGuideEnabled = nextEnabled;
    savePreviewGuideEnabled(nextEnabled);
    renderLedFrame();
  };

  const stopPlayback = (): void => {
    playbackScheduler?.stop();
  };

  const startPlayback = (): void => {
    if (!previewData || previewData.noteCount === 0) {
      uiState.previewMetaText =
        'No preview notes available. Change parameters to generate a pattern first.';
      return;
    }

    if (!playbackScheduler || playbackScheduler.isPlaying()) {
      return;
    }

    playbackScheduler.start();
  };

  const applyPreviewData = (
    preview: GeneratorPreview,
    target: BridgeTarget | null,
    bridge: BridgeSettings | null,
    source: 'preview' | 'send',
    sourceChain: GeneratorChain,
  ): void => {
    previewRevision += 1;
    previewData = preview;
    previewSourceChain = sourceChain;
    previewLedFrameCache = buildLedFrameCache(preview);
    uiState.previewLoopLengthBeats = bridge?.autoCreateLengthBeats ?? readBridge().autoCreateLengthBeats;
    if (playbackScheduler) {
      playbackScheduler.setCurrentBeat(0);
    } else {
      currentBeat = 0;
      renderLedFrame();
    }

    const modeLabel = source === 'send' ? 'Send complete' : 'Preview generated';
    const targetLabel = target
      ? ` | ${target.host}:${target.port}${target.path}`
      : '';
    uiState.previewMetaText = `${modeLabel} | Notes ${preview.noteCount}${targetLabel}`;

    if (preview.noteCount > 0) {
      startPlayback();
      return;
    }

    stopPlayback();
  };

  const runPreview = async (): Promise<void> => {
    uiState.statusText = 'Updating preview...';

    try {
      const requestChain = cloneChainForIpc(uiState.chainState);
      const preview = generateRendererPreview(
        requestChain,
        uiState.previewLoopLengthBeats,
        uiState.launchpadModel,
      );
      applyPreviewData(preview, null, null, 'preview', requestChain);
      uiState.statusText = 'Preview updated';
    } catch (error) {
      stopPlayback();
      uiState.statusText = 'Preview update failed';
      uiState.previewMetaText =
        error instanceof Error ? error.message : 'Unknown preview error';
    }
  };

  const clearSendDoneTimer = (): void => {
    if (sendDoneTimer !== null) {
      window.clearTimeout(sendDoneTimer);
      sendDoneTimer = null;
    }
  };

  const openSettings = (): void => {
    uiState.isSettingsOpen = true;
  };

  const closeSettings = (): void => {
    uiState.isSettingsOpen = false;
  };

  const handleSettingsFormSubmit = (event: SubmitEvent): void => {
    event.preventDefault();
  };

  const handleBrowserDeviceAdd = (kind: BrowserDeviceKind): void => {
    if (!isBrowserDeviceKind(kind)) {
      return;
    }
    applyChainMutation(withDevices(
      uiState.chainState,
      applyInsertDeviceByDropZone(
        uiState.chainState.devices,
        createDeviceNodeByKind(kind),
        {
          kind: 'outside',
          targetId: null,
          placement: 'after',
        },
      ),
    ), HISTORY_META.addDevice);
  };

  const handleBrowserPointerDown = (payload: {
    kind: BrowserDeviceKind;
    sourceEvent: PointerEvent;
    itemEl: HTMLElement;
  }): void => {
    deviceRackComponent?.handleBrowserPointerDown(
      payload.sourceEvent,
      payload.kind,
      payload.itemEl,
    );
  };

  const handleRackCommit = (commit: RackInteractionCommit): void => {
    if (commit.kind === 'move') {
      const nextDevices = applyMoveDevicesByDropZone(
        uiState.chainState.devices,
        commit.sourceIds,
        commit.dropZone,
        commit.sourceKind,
      );
      const changed = nextDevices !== null;
      if (changed) {
        applyChainMutation(withDevices(uiState.chainState, nextDevices), HISTORY_META.moveDevices);
      }
      return;
    }

    applyChainMutation(withDevices(
      uiState.chainState,
      applyInsertDeviceByDropZone(
        uiState.chainState.devices,
        createDeviceNodeByKind(commit.sourceKind),
        commit.dropZone,
      ),
    ), HISTORY_META.insertDevice);
  };

  const handleSettingsSave = (): void => {
    const bridge = readBridge();
    writeBridgeInputs(bridge);
    saveBridgeSettings(bridge);
    saveLaunchpadModel(uiState.launchpadModel);
    uiState.statusText = 'Settings saved';
    runBestEffort(requestLiveTempoSync());
    closeSettings();
  };

  const handleAutoCreateLengthChange = (): void => {
    const bridge = readBridge();
    uiState.previewLoopLengthBeats = bridge.autoCreateLengthBeats;
    saveBridgeSettings(bridge);
    uiState.statusText = `Length changed (${uiState.autoCreateLengthLabel})`;
    scheduleAutoPreview(0);
  };

  const handleChainSave = (
    chain: GeneratorChain,
    meta: ChainMutationMeta,
  ): void => {
    chainHistory.push(chain, meta);
    syncHistoryUiState();
    saveChainSettings(chain);
  };

  const handlePaletteFileChange = async (event: Event): Promise<void> => {
    const input = event.currentTarget instanceof HTMLInputElement ? event.currentTarget : null;
    const file = input?.files?.[0];
    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      const payload: PaletteFilePayload = {
        name: file.name,
        content,
      };
      paletteController.applyUploadedPalette(payload);
      renderLedFrame();
      uiState.statusText = 'Custom palette loaded';
    } catch (error) {
      uiState.statusText = 'Palette load failed';
      uiState.previewMetaText =
        error instanceof Error ? error.message : 'Unknown palette error';
    } finally {
      if (input) {
        input.value = '';
      }
    }
  };

  const handlePaletteReset = (): void => {
    const loaded = paletteController.resetToDefault();
    renderLedFrame();
    uiState.statusText = loaded
      ? 'Default palette loaded'
      : 'Default palette unavailable, using embedded colors';
  };

  const handleLaunchpadModelToggle = (nextEnabled: boolean): void => {
    const nextModel: LaunchpadModel = nextEnabled ? 'mk2' : 'mk3';
    if (uiState.launchpadModel === nextModel) {
      return;
    }
    uiState.launchpadModel = nextModel;
    saveLaunchpadModel(nextModel);
    uiState.statusText = `Launchpad model: ${nextModel.toUpperCase()}`;
    scheduleAutoPreview(0);
    renderLedFrame();
  };

  const handlePreviewPlayClick = (): void => {
    if (isPlaying) {
      stopPlayback();
      return;
    }

    startPlayback();
  };

  const handlePreviewLoopToggle = (): void => {
    uiState.isPreviewLoopEnabled = !uiState.isPreviewLoopEnabled;
    savePreviewLoopEnabled(uiState.isPreviewLoopEnabled);
    renderLedFrame();
  };

  const handlePreviewGuideToggle = (nextEnabled: boolean): void => {
    applyPreviewGuideEnabled(nextEnabled);
  };

  const handlePreviewPopout = async (): Promise<void> => {
    try {
      await bridgeClient.openPreviewWindow();
      uiState.isPreviewPopoutOpen = true;
      renderLedFrame();
    } catch {
      uiState.statusText = 'Failed to open preview popout';
    }
  };

  const handlePreviewScrubInput = (): void => {
    const nextBeat = clamp(Number(uiState.previewScrubValue) / SCRUB_MAX, 0, 1);
    if (playbackScheduler) {
      playbackScheduler.setCurrentBeat(nextBeat);
      return;
    }

    currentBeat = nextBeat;
    renderLedFrame();
  };

  const handleSendClick = async (): Promise<void> => {
    if (autoPreviewTimer !== null) {
      window.clearTimeout(autoPreviewTimer);
      autoPreviewTimer = null;
    }

    clearSendDoneTimer();
    uiState.sendButtonDisabled = true;
    uiState.sendButtonLabel = 'Sending...';
    uiState.statusText = 'Sending...';

    try {
      const bridge = readBridge();
      writeBridgeInputs(bridge);
      saveBridgeSettings(bridge);
      const requestChain = cloneChainForIpc(uiState.chainState);

      const request: GenerateAndSendRequest = {
        chain: requestChain,
        bridge,
        launchpadModel: uiState.launchpadModel,
      };
      const response = await bridgeClient.generateAndSend(request);
      applyPreviewData(response.preview, response.target, response.bridge, 'send', requestChain);
      uiState.statusText = 'Idle';
      uiState.sendButtonDisabled = false;
      uiState.sendButtonLabel = 'Done!';
      sendDoneTimer = window.setTimeout(() => {
        sendDoneTimer = null;
        uiState.sendButtonLabel = 'Send';
      }, SEND_DONE_MS);
    } catch (error) {
      stopPlayback();
      uiState.statusText = 'Send failed';
      uiState.previewMetaText =
        error instanceof Error ? error.message : 'Unknown send error';
      uiState.sendButtonDisabled = false;
      uiState.sendButtonLabel = 'Send';
    }
  };

  const handleContextMenuDelete = (target: ContextMenuTarget): void => {
    if (target.kind === 'group') {
      deleteGroup(target.groupId);
      return;
    }

    if (target.deviceIds.length === 0) {
      return;
    }
    deleteDevicesById(target.deviceIds);
  };

  const withContextSelection = (
    target: ContextMenuTarget,
    action: (selection: RackSelectionSnapshot | null) => void,
  ): void => {
    action(resolveSelectionSnapshotFromContextTarget(target));
  };

  const runContextClipboardAction = (
    target: ContextMenuTarget,
    action: (selectionOverride?: RackSelectionSnapshot | null) => unknown,
  ): void => {
    withContextSelection(target, (selection) => {
      action(selection);
    });
  };

  const handleContextMenuCopy = (target: ContextMenuTarget): void => {
    runContextClipboardAction(target, copySelectionToClipboard);
  };

  const handleContextMenuCut = (target: ContextMenuTarget): void => {
    runContextClipboardAction(target, cutSelection);
  };

  const handleContextMenuPaste = (target: ContextMenuTarget): void => {
    withContextSelection(target, (selection) => {
      pasteClipboard(undefined, selection);
    });
  };

  const handleContextMenuDuplicate = (target: ContextMenuTarget): void => {
    runContextClipboardAction(target, duplicateSelection);
  };

  const handleContextMenuGroup = (targetIds: string[]): void => {
    if (!canCreateGroupFromSelection(targetIds)) {
      return;
    }
    const groupId = getNextGroupId();
    setGroupIdForDevices(targetIds, groupId, HISTORY_META.groupCreate);
  };

  const handleContextMenuUngroupGroup = (groupId: string): void => {
    if (!groupId) {
      return;
    }
    ungroupGroup(groupId, HISTORY_META.groupUngroup);
  };


  onMount(() => {
    reconcileCurrentChainModulators();
    chainHistory.replaceCurrent(uiState.chainState);
    syncHistoryUiState();
    void syncRackAfterRender();
    playbackScheduler = createPlaybackScheduler({
      getLoopMs: () => getPreviewLoopMs(),
      isLoopEnabled: () => uiState.isPreviewLoopEnabled,
      onFrame: (nextBeat) => {
        currentBeat = nextBeat;
        renderLedFrame();
      },
      onPlayStateChange: (nextIsPlaying) => {
        isPlaying = nextIsPlaying;
        uiState.previewPlayLabel = nextIsPlaying ? 'Pause' : 'Play';
      },
    });

    liveTempoUnsubscribe = bridgeClient.subscribeLiveTempo((update) => {
      const nextBpm = sanitizePreviewBpm(update.bpm);
      if (Math.abs(nextBpm - uiState.previewBpm) < 0.0001) {
        return;
      }

      uiState.previewBpm = nextBpm;
      savePreviewBpm(nextBpm);
      uiState.statusText = `Live BPM sync (${nextBpm})`;
    });

    previewWindowVisibilityUnsubscribe = bridgeClient.subscribePreviewWindowVisibility((isOpen) => {
      uiState.isPreviewPopoutOpen = isOpen;
    });

    previewGuideEnabledUnsubscribe = bridgeClient.subscribePreviewGuideEnabledUpdate((enabled) => {
      applyPreviewGuideEnabled(enabled === true);
    });

    runBestEffort(
      bridgeClient.requestPreviewWindowVisibility().then((isOpen) => {
        uiState.isPreviewPopoutOpen = isOpen === true;
      }),
    );

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        contextMenuComponent?.close();
        closeSettings();
        return;
      }

      const target = event.target instanceof Element ? event.target : null;
      if (isTextEditingElement(target)) {
        return;
      }

      const isGroupShortcut =
        (event.metaKey || event.ctrlKey)
        && event.key.toLowerCase() === 'g';
      if (isGroupShortcut) {
        const selectedGroups = deviceRackComponent?.getSelectedGroupContexts() ?? [];
        const targetIds = deviceRackComponent?.getOrderedSelectedDeviceIds() ?? [];
        if (event.shiftKey) {
          if (selectedGroups.length === 0) {
            return;
          }

          event.preventDefault();
          contextMenuComponent?.close();
          for (const selectedGroup of selectedGroups) {
            handleContextMenuUngroupGroup(selectedGroup.groupId);
          }
          return;
        }

        if (selectedGroups.length > 0 || !canCreateGroupFromSelection(targetIds)) {
          return;
        }

        event.preventDefault();
        contextMenuComponent?.close();
        handleContextMenuGroup(targetIds);
        return;
      }

      const isModifierShortcut = (event.metaKey || event.ctrlKey) && !event.altKey;
      if (isModifierShortcut) {
        const key = event.key.toLowerCase();
        const isUndoShortcut = key === 'z' && !event.shiftKey;
        if (isUndoShortcut) {
          if (handleUndo()) {
            event.preventDefault();
            contextMenuComponent?.close();
          }
          return;
        }

        const isRedoShortcut =
          (key === 'z' && event.shiftKey)
          || (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey);
        if (isRedoShortcut) {
          if (handleRedo()) {
            event.preventDefault();
            contextMenuComponent?.close();
          }
          return;
        }

        if (key === 'c') {
          if (copySelectionToClipboard()) {
            event.preventDefault();
            contextMenuComponent?.close();
          }
          return;
        }

        if (key === 'x') {
          if (cutSelection()) {
            event.preventDefault();
            contextMenuComponent?.close();
          }
          return;
        }

        if (key === 'v') {
          if (pasteClipboard()) {
            event.preventDefault();
            contextMenuComponent?.close();
          }
          return;
        }

        if (key === 'd') {
          if (duplicateSelection()) {
            event.preventDefault();
            contextMenuComponent?.close();
          }
          return;
        }

        if (key === 'a') {
          event.preventDefault();
          contextMenuComponent?.close();
          selectAllRackDevices();
          return;
        }
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      const selectedGroups = deviceRackComponent?.getSelectedGroupContexts() ?? [];
      const selectedDeviceIds = deviceRackComponent?.getOrderedSelectedDeviceIds() ?? [];
      // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Ephemeral union set used only in this handler.
      const deleteIdSet = new Set(selectedDeviceIds);
      for (const selectedGroup of selectedGroups) {
        for (const memberId of selectedGroup.memberDeviceIds) {
          deleteIdSet.add(memberId);
        }
      }
      const targetIds = toExistingOrderedDeviceIds([...deleteIdSet]);
      if (targetIds.length === 0) {
        return;
      }

      event.preventDefault();
      contextMenuComponent?.close();
      deleteDevicesById(targetIds);
    };

    const handleFocusIn = (event: FocusEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (!isTextEditingElement(target)) {
        return;
      }
      deviceRackComponent?.clearSelection();
    };

    const handleWindowPointerDown = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) {
        return;
      }

      const rackEl = document.getElementById('chain-devices');
      if (rackEl && rackEl.contains(target)) {
        return;
      }

      deviceRackComponent?.clearSelection();
    };

    const handleBeforeUnload = (): void => {
      if (liveTempoUnsubscribe) {
        liveTempoUnsubscribe();
        liveTempoUnsubscribe = null;
      }
    };


    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('focusin', handleFocusIn);
    window.addEventListener('pointerdown', handleWindowPointerDown);
    window.addEventListener('beforeunload', handleBeforeUnload);

    runBestEffort(requestLiveTempoSync());

    paletteController.initialize();
    renderLedFrame();
    scheduleAutoPreview(0);

    return () => {
      playbackScheduler?.teardown();
      playbackScheduler = null;
      previewWindowStatePusher.reset();
      chainHistory.flushPendingMerge();
      if (autoPreviewTimer !== null) {
        window.clearTimeout(autoPreviewTimer);
      }
      if (sendDoneTimer !== null) {
        window.clearTimeout(sendDoneTimer);
      }

      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('focusin', handleFocusIn);
      window.removeEventListener('pointerdown', handleWindowPointerDown);
      window.removeEventListener('beforeunload', handleBeforeUnload);

      if (liveTempoUnsubscribe) {
        liveTempoUnsubscribe();
        liveTempoUnsubscribe = null;
      }
      if (previewWindowVisibilityUnsubscribe) {
        previewWindowVisibilityUnsubscribe();
        previewWindowVisibilityUnsubscribe = null;
      }
      if (previewGuideEnabledUnsubscribe) {
        previewGuideEnabledUnsubscribe();
        previewGuideEnabledUnsubscribe = null;
      }
    };
  });

  // Reflect state classes directly on the #app mount element.
  $effect(() => {
    const appEl = document.getElementById('app');
    if (!appEl) return;

    appEl.classList.toggle('is-settings-open', uiState.isSettingsOpen);
    appEl.classList.toggle('is-sidebar-resizing', uiState.isSidebarResizing);
    appEl.style.setProperty('--sidebar-width', `${uiState.sidebarWidthPx}px`);
  });
</script>

<section class="live-main" hidden={uiState.isSettingsOpen}>
    <BrowserPanel
      onDeviceAdd={handleBrowserDeviceAdd}
      onBrowserPointerDown={handleBrowserPointerDown}
    />

    <SidebarResizer
      bind:width={uiState.sidebarWidthPx}
      bind:isResizing={uiState.isSidebarResizing}
      isBlocked={!!deviceRackComponent?.hasPointerInteraction()}
      sanitizeWidth={sanitizeSidebarWidth}
      onSave={saveSidebarWidth}
    />

    <section class="workspace">
      <header class="workspace-head">
        <div class="workspace-head-left">
          <span id="preview-bpm-text" class="header-bpm-text">{toBpmText(uiState.previewBpm)}</span>

          <span id="preview-meta" class="header-preview-meta">{uiState.previewMetaText}</span>
        </div>

        <div class="workspace-actions">
          <span id="status" aria-live="polite">{uiState.statusText}</span>
          <div class="header-length-select">
            <span class="field-label">Length</span>
            <select
              id="auto-create-length-select"
              name="autoCreateLength"
              bind:value={uiState.autoCreateLengthLabel}
              onchange={handleAutoCreateLengthChange}
            >
              {#each AUTO_CREATE_LENGTH_OPTIONS as option (option.label)}
                <option value={option.label}>{option.label}</option>
              {/each}
            </select>
          </div>
          <button
            id="undo-button"
            type="button"
            disabled={!canUndo}
            title={canUndo ? `Undo: ${undoActionLabel}` : 'Nothing to undo'}
            aria-label={canUndo ? `Undo: ${undoActionLabel}` : 'Undo unavailable'}
            onclick={handleUndoClick}
          >
            Undo
          </button>
          <button
            id="redo-button"
            type="button"
            disabled={!canRedo}
            title={canRedo ? `Redo: ${redoActionLabel}` : 'Nothing to redo'}
            aria-label={canRedo ? `Redo: ${redoActionLabel}` : 'Redo unavailable'}
            onclick={handleRedoClick}
          >
            Redo
          </button>
          <button id="settings-button" type="button" onclick={openSettings}>
            Settings
          </button>
          <button
            id="send-button"
            class="primary"
            type="button"
            disabled={uiState.sendButtonDisabled}
            onclick={handleSendClick}
          >
            {uiState.sendButtonLabel}
          </button>
        </div>
      </header>

      <section class="workspace-rack">
        <DeviceRack
          bind:this={deviceRackComponent}
          devices={uiState.chainState.devices}
          chainState={uiState.chainState}
          collapsedDeviceIds={collapsedDeviceIds}
          {currentBeat}
          {modulationReadoutById}
          isSidebarResizing={uiState.isSidebarResizing}
          interactiveElementSelector={INTERACTIVE_ELEMENT_SELECTOR}
          onSaveChain={handleChainSave}
          onScheduleAutoPreview={(delayMs) => scheduleAutoPreview(delayMs)}
          onOpenContextMenu={(x, y, target) => contextMenuComponent?.open(x, y, target)}
          onCloseContextMenu={() => contextMenuComponent?.close()}
          onGetBrowserDragBadgeLabel={toBrowserDragBadgeLabel}
          onCommit={handleRackCommit}
          onToggleGroupEnabled={handleToggleGroupEnabled}
          onToggleCollapse={toggleCollapse}
        />
        {#if !uiState.isPreviewPopoutOpen}
          <PreviewPanel
            previewState={previewSurfaceState}
            onGuideToggle={handlePreviewGuideToggle}
            onPopout={handlePreviewPopout}
            playLabel={uiState.previewPlayLabel}
            loopEnabled={uiState.isPreviewLoopEnabled}
            onPlayClick={handlePreviewPlayClick}
            onLoopToggle={handlePreviewLoopToggle}
            bind:scrubValue={uiState.previewScrubValue}
            onScrubInput={handlePreviewScrubInput}
          />
        {/if}
      </section>
    </section>
  </section>

  <section
    id="settings-screen"
    class="settings-screen"
    aria-hidden={uiState.isSettingsOpen ? 'false' : 'true'}
    aria-labelledby="settings-title"
    hidden={!uiState.isSettingsOpen}
  >
    <header class="settings-screen-head">
      <h1 id="settings-title">Settings</h1>
      <button id="settings-close" type="button" onclick={closeSettings}>
        Close
      </button>
    </header>

    <div class="settings-screen-body">
      <form id="settings-form" class="settings-form" onsubmit={handleSettingsFormSubmit}>
        <div class="control-field">
          <label for="launchpad-model-mk2" class="field-label">Launchpad MK2 Mode</label>
          <input
            id="launchpad-model-mk2"
            type="checkbox"
            checked={uiState.launchpadModel === 'mk2'}
            onchange={(event) => {
              const target = event.currentTarget as HTMLInputElement;
              handleLaunchpadModelToggle(target.checked);
            }}
          />
        </div>
        <div class="control-field">
          <span class="field-label">Palette File</span>
          <input
            id="palette-file-input"
            type="file"
            accept=".txt,.csv,.palette,text/plain"
            onchange={handlePaletteFileChange}
          />
        </div>

        <div class="settings-palette-row">
          <span id="palette-name">{uiState.paletteNameText}</span>
          <button id="palette-reset" type="button" onclick={handlePaletteReset}>
            Reset to Default
          </button>
        </div>
      </form>
    </div>

    <footer class="settings-screen-actions">
      <button id="settings-save" class="primary" type="button" onclick={handleSettingsSave}>
        Save
      </button>
    </footer>
  </section>

  <ContextMenu
    bind:this={contextMenuComponent}
    onCopy={handleContextMenuCopy}
    onCut={handleContextMenuCut}
    onPaste={handleContextMenuPaste}
    onDuplicate={handleContextMenuDuplicate}
    onDelete={handleContextMenuDelete}
    onGroup={handleContextMenuGroup}
    onUngroupGroup={handleContextMenuUngroupGroup}
    clipboardAvailable={rackClipboard !== null}
  />
