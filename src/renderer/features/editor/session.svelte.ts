import type { BridgeSettings } from '../../../shared/bridge/types';
import { SvelteSet } from 'svelte/reactivity';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import {
  cloneChainForIpc,
  isCurveModulatorNode,
  normalizeAuthoredMetadata,
  replaceAuthoredMetadata,
  type AuthoredMetadata,
  type GeneratorChain,
  type LaunchpadModel,
} from '../../../shared/model';
import type {
  DevicePresetFile,
  GroupPresetFile,
  RackPresetFile,
} from '../../../shared/presets';
import type { RendererDeviceKind } from '../../../devices';
import type { BrowserPage } from '../browser/types';
import { isRendererDeviceKind } from '../../../devices';
import {
  isRackSelectionContextTarget,
  type ContextMenuTarget,
  type ModulationParameterContextTarget,
} from '../context-menu/types';
import type {
  BrowserNonRackPresetInsertSource,
  BrowserInsertSource,
  RackOutputPreviewMode,
  RackInteractionCommit,
} from '../rack/types';
import type { RackDropZone } from '../rack/drop-ops';
import type { GroupSelectionContext, RackSelectionItem } from '../rack/selection.svelte';
import {
  applyBridgeSettings as applyEditorBridgeSettings,
  handleAutoCreateLengthChange,
  readBridgeSettingsFromLabel,
  setLaunchpadModelEnabled,
  syncPreviewBpm,
  togglePreviewLoopEnabled,
} from './bridge-settings';
import {
  copySelectionToClipboard as copySelectionToEditorClipboard,
  cutSelection as cutEditorSelection,
  duplicateSelection as duplicateEditorSelection,
  pasteClipboard as pasteEditorClipboard,
  resolveContextSelection as resolveEditorContextSelection,
} from './clipboard';
import {
  EDITOR_HISTORY_META,
  applyBrowserDeviceAdd,
  applyRackCommit,
  toggleRackSelectionEnabled,
} from './commands';
import {
  createEditorHistory,
  type EditorHistoryListEntry,
  type EditorHistory,
} from './editor-history';
import {
  commitChainMutation as commitEditorChainMutation,
  checkoutHistory as checkoutEditorHistory,
  initializeHistoryBridge,
  redoHistory,
  resetChainHistory,
  syncHistoryState,
  undoHistory,
} from './history-bridge';
import {
  deleteCurrentSelection as deleteEditorSelection,
  deleteDevicesById as deleteEditorDevicesById,
  deleteGroup as deleteEditorGroup,
  groupCurrentSelection as groupEditorSelection,
  groupDeviceIds as groupEditorDeviceIds,
  toggleGroupEnabled as toggleEditorGroupEnabled,
  toggleGroupIsolated as toggleEditorGroupIsolated,
  ungroupGroup as ungroupEditorGroup,
  ungroupSelectedGroups as ungroupEditorSelections,
} from './grouping';
import {
  createInitialEditorState,
  mergeCollapsedDeviceIds,
  persistChainState as persistEditorChainState,
  persistSidebarWidth,
  replaceCollapsedDeviceIds,
  toggleCollapse,
} from './persistence';
import { buildOrderedGroupIds } from '../rack/layout';
import {
  allocateDeviceNodeId,
} from './device-node-factory';
import {
  renameDeviceById,
  renameGroupById,
} from './naming';
import {
  updateDeviceAuthoredInfo,
  updateGroupAuthoredInfo,
  updateRackAuthoredMetadata,
  type AuthoredInfoDraft,
} from './authored-info';
import {
  applyRackPresetFile,
  type GroupPresetApplyResult,
  insertDevicePresetFile,
  insertGroupPresetFile,
  type PresetApplyResult,
  type RackPresetApplyResult,
} from './presets';
import type { RackClipboard } from './rack-clipboard';
import type { ChainMutationMeta } from './history-core';
import {
  resolveCurrentSelectionSnapshot,
  type RackSelectionSnapshot,
} from './selectors';
import type { ChainHistoryKind } from './history-core';
import type { ScheduledPreviewGenerationReason } from '../preview/generation-reason';

const DEFAULT_AUTO_PREVIEW_DEBOUNCE_MS = 120;
const DEFAULT_HISTORY_MAX_ENTRIES = 100;

export interface EditorSessionState {
  sidebarPage: BrowserPage;
  chainState: GeneratorChain;
  chainRevision: number;
  previewSourceRevision: number;
  launchpadModel: LaunchpadModel;
  headerIndicatorText: string;
  paletteName: string;
  paletteSource: 'loading' | 'default' | 'custom' | 'fallback';
  previewBpm: number;
  previewLoopLengthBeats: number;
  isPreviewLoopEnabled: boolean;
  isPreviewPopoutOpen: boolean;
  previewScrubValue: number;
  autoCreateLengthLabel: string;
  isDelivering: boolean;
  deliveryButtonState: 'idle' | 'working' | 'done';
  sidebarWidthPx: number;
  isSidebarResizing: boolean;
  collapsedDeviceIds: string[];
  clipboardAvailable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoActionKind: ChainHistoryKind | null;
  redoActionKind: ChainHistoryKind | null;
}

export interface EditorRackBinding {
  getSelectedGroupContexts(): GroupSelectionContext[];
  getOrderedSelectedDeviceIds(): string[];
  selectAllRackItems(): void;
  setSelectedDeviceIds(ids: readonly string[]): void;
  setSelectedGroupIds(ids: readonly string[]): void;
  setSelectedRackItems(
    deviceIds: readonly string[],
    groupIds: readonly string[],
    anchor: RackSelectionItem | null,
  ): void;
  applyNextSelectionAfterDelete(deviceIds: readonly string[]): void;
  clearSelection(): void;
  syncAfterRender(): void;
  startRenamingDevice(deviceId: string): boolean;
  startRenamingGroup(groupId: string): boolean;
  handleBrowserPointerDown(
    event: PointerEvent,
    source: BrowserInsertSource,
    itemEl: HTMLElement,
    badgeLabel: string,
  ): void;
}

interface AutoPreviewRequest {
  reason: ScheduledPreviewGenerationReason;
}

interface EditorSessionOptions {
  autoPreviewDebounceMs?: number;
  historyMaxEntries?: number;
  onAutoPreview?: (request: AutoPreviewRequest) => void | Promise<void>;
  onSyncAfterRender?: () => void | Promise<void>;
}

export class EditorSession {
  public readonly state: EditorSessionState = $state(createInitialEditorState());

  private readonly history: EditorHistory;

  private readonly autoPreviewDebounceMs: number;

  private readonly onAutoPreview: ((request: AutoPreviewRequest) =>
    void | Promise<void>) | null;

  private readonly onSyncAfterRender: (() => void | Promise<void>) | null;

  private autoPreviewTimer: number | null = null;

  private pendingAutoPreviewReason: ScheduledPreviewGenerationReason | null = null;

  private rackBinding: EditorRackBinding | null = null;

  private rackClipboard: RackClipboard | null = null;

  public constructor(options: EditorSessionOptions = {}) {
    this.history = createEditorHistory(this.state.chainState, {
      maxEntries: options.historyMaxEntries ?? DEFAULT_HISTORY_MAX_ENTRIES,
    });
    this.autoPreviewDebounceMs =
      options.autoPreviewDebounceMs ?? DEFAULT_AUTO_PREVIEW_DEBOUNCE_MS;
    this.onAutoPreview = options.onAutoPreview ?? null;
    this.onSyncAfterRender = options.onSyncAfterRender ?? null;
    syncHistoryState(this.state, this.history);
  }

  public initialize(): void {
    initializeHistoryBridge(this.state, this.history, {
      requestSyncAfterRender: () => this.requestSyncAfterRender(),
    });
  }

  public dispose(): void {
    this.cancelAutoPreview();
    this.history.flushPendingMerge();
  }

  public attachRackBinding(binding: EditorRackBinding | null): void {
    this.rackBinding = binding;
  }

  public readonly commands = {
    persistSidebarWidth: (nextWidth?: number): void => {
      persistSidebarWidth(this.state, nextWidth);
    },
    toggleCollapse: (id: string): void => {
      toggleCollapse(this.state, id);
    },
    commitOutputChain: (
      chain: GeneratorChain,
      meta: ChainMutationMeta,
      previewMode: RackOutputPreviewMode = 'debounced',
    ): void => {
      this.commitOutputMutation(chain, meta, previewMode);
    },
    addBrowserDevice: (kind: RendererDeviceKind): void => {
      if (!isRendererDeviceKind(kind)) {
        return;
      }

      const previousChain = this.state.chainState;
      const nextChain = applyBrowserDeviceAdd(previousChain, kind);
      this.applyChainMutation(
        nextChain,
        EDITOR_HISTORY_META.addDevice,
      );
      this.selectInsertedDevices(previousChain, nextChain);
    },
    handleBrowserPointerDown: (payload: {
      source: BrowserInsertSource;
      badgeLabel: string;
      sourceEvent: PointerEvent;
      itemEl: HTMLElement;
    }): void => {
      this.rackBinding?.handleBrowserPointerDown(
        payload.sourceEvent,
        payload.source,
        payload.itemEl,
        payload.badgeLabel,
      );
    },
    handlePresetInsertDrop: (
      source: BrowserNonRackPresetInsertSource,
      dropZone: RackDropZone,
    ): void => {
      if (source.kind === 'device-preset') {
        this.insertDevicePreset(dropZone, source.preset);
        return;
      }

      this.insertGroupPreset(dropZone, source.preset);
    },
    handleRackCommit: (commit: RackInteractionCommit): void => {
      const previousChain = this.state.chainState;
      const nextChain = applyRackCommit(previousChain, commit);
      if (!nextChain) {
        return;
      }

      this.applyChainMutation(
        nextChain,
        commit.kind === 'move'
          ? EDITOR_HISTORY_META.moveDevices
          : commit.kind === 'insert-devices'
            ? EDITOR_HISTORY_META.insertDevices
            : EDITOR_HISTORY_META.insertDevice,
      );
      if (commit.kind === 'insert-device' || commit.kind === 'insert-devices') {
        this.selectInsertedDevices(previousChain, nextChain);
      }
    },
    disconnectModulation: (
      target: ModulationParameterContextTarget,
      modulatorId?: string,
    ): void => {
      const nextChain = cloneChainForIpc(this.state.chainState);
      const modulatorIds = modulatorId
        ? [modulatorId]
        : target.connections.map((connection) => connection.modulatorId);
      let changed = false;

      for (const device of nextChain.devices) {
        if (!isCurveModulatorNode(device) || !modulatorIds.includes(device.id)) {
          continue;
        }

        const nextTargets = device.params.targets.filter((modulationTarget) =>
          modulationTarget.deviceId !== target.deviceId
          || modulationTarget.paramKey !== target.paramKey);
        if (nextTargets.length === device.params.targets.length) {
          continue;
        }

        device.params.targets = nextTargets;
        changed = true;
      }

      if (changed) {
        this.applyChainMutation(nextChain, {
          kind: 'control-edit',
          finalize: true,
        });
      }
    },
    toggleGroupEnabled: (groupId: string, nextEnabled: boolean): void => {
      toggleEditorGroupEnabled(this.buildGroupingContext(), groupId, nextEnabled);
    },
    toggleGroupIsolated: (groupId: string, nextIsolated: boolean): void => {
      toggleEditorGroupIsolated(this.buildGroupingContext(), groupId, nextIsolated);
    },
    handleAutoCreateLengthChange: (): void => {
      handleAutoCreateLengthChange(this.state, (delayMs) => this.requestOutputPreview(delayMs));
    },
    undo: (): boolean => this.undo(),
    redo: (): boolean => this.redo(),
    checkoutHistory: (targetId: string): boolean => this.checkoutHistory(targetId),
    copySelection: (): boolean => this.copySelectionToClipboard() !== null,
    cutSelection: (): boolean => this.cutSelection(),
    pasteClipboard: (): boolean => this.pasteClipboard(),
    duplicateSelection: (): boolean => this.duplicateSelection(),
    toggleRackSelectionEnabled: (): boolean => this.toggleRackSelectionEnabled(),
    collapseSelection: (): boolean => this.setSelectedDevicesCollapsed(true),
    expandSelection: (): boolean => this.setSelectedDevicesCollapsed(false),
    selectAllRackItems: (): boolean => {
      const rackBinding = this.rackBinding;
      if (!rackBinding) {
        return false;
      }

      rackBinding.selectAllRackItems();
      return true;
    },
    deleteSelection: (): boolean => this.deleteCurrentSelection(),
    groupSelection: (): boolean => this.groupCurrentSelection(),
    ungroupSelectedGroups: (): boolean => this.ungroupSelectedGroups(),
    beginRenameSelection: (): boolean => this.beginRenameSelection(),
    deleteFromContextTarget: (target: ContextMenuTarget): void => {
      if (!isRackSelectionContextTarget(target)) {
        return;
      }

      if (target.kind === 'group') {
        this.deleteGroup(target.groupId);
        return;
      }
      if (target.deviceIds.length === 0) {
        return;
      }

      this.deleteDevicesById(target.deviceIds);
    },
    copyFromContextTarget: (target: ContextMenuTarget): void => {
      if (!isRackSelectionContextTarget(target)) {
        return;
      }

      this.copySelectionToClipboard(this.resolveContextSelection(target));
    },
    cutFromContextTarget: (target: ContextMenuTarget): void => {
      if (!isRackSelectionContextTarget(target)) {
        return;
      }

      this.cutSelection(this.resolveContextSelection(target));
    },
    pasteFromContextTarget: (target: ContextMenuTarget): void => {
      if (!isRackSelectionContextTarget(target)) {
        return;
      }

      this.pasteClipboard(undefined, this.resolveContextSelection(target));
    },
    duplicateFromContextTarget: (target: ContextMenuTarget): void => {
      if (!isRackSelectionContextTarget(target)) {
        return;
      }

      this.duplicateSelection(this.resolveContextSelection(target));
    },
    beginRenameFromContextTarget: (target: ContextMenuTarget): boolean =>
      this.beginRenameFromContextTarget(target),
    groupDeviceIds: (targetIds: string[]): void => {
      this.groupDeviceIds(targetIds);
    },
    ungroupGroup: (groupId: string): void => {
      this.ungroupGroup(groupId, EDITOR_HISTORY_META.groupUngroup);
    },
    renameDevice: (deviceId: string, rawName: string): boolean =>
      this.renameDevice(deviceId, rawName),
    renameGroup: (groupId: string, rawName: string): boolean =>
      this.renameGroup(groupId, rawName),
    updateDeviceInfo: (deviceId: string, draft: AuthoredInfoDraft): boolean =>
      this.updateDeviceInfo(deviceId, draft),
    updateGroupInfo: (groupId: string, draft: AuthoredInfoDraft): boolean =>
      this.updateGroupInfo(groupId, draft),
    updateRackInfo: (
      draft: Pick<AuthoredInfoDraft, 'author' | 'description'>,
    ): boolean => this.updateRackInfo(draft),
    insertDevicePreset: (
      dropZone: RackDropZone,
      preset: DevicePresetFile,
    ): PresetApplyResult => this.insertDevicePreset(dropZone, preset),
    insertGroupPreset: (
      dropZone: RackDropZone,
      preset: GroupPresetFile,
    ): GroupPresetApplyResult => this.insertGroupPreset(dropZone, preset),
    applyRackPreset: (preset: RackPresetFile): RackPresetApplyResult => this.applyRackPreset(preset),
    setLaunchpadModelEnabled: (nextEnabled: boolean): boolean =>
      setLaunchpadModelEnabled(this.state, nextEnabled, (delayMs) =>
        this.requestOutputPreview(delayMs)),
    togglePreviewLoopEnabled: (): boolean => togglePreviewLoopEnabled(this.state),
    syncPreviewBpm: (nextBpm: number): boolean => syncPreviewBpm(this.state, nextBpm),
  };

  public scheduleInitialPreview(delayMs = 0): void {
    this.scheduleAutoPreview(delayMs, 'initial');
  }

  public requestOutputPreview(delayMs = this.autoPreviewDebounceMs): void {
    this.requestRegeneratedPreview('output-change', delayMs);
  }

  private requestRegeneratedPreview(
    reason: Exclude<ScheduledPreviewGenerationReason, 'initial'>,
    delayMs: number,
  ): void {
    this.state.previewSourceRevision += 1;
    this.scheduleAutoPreview(delayMs, reason);
  }

  private scheduleAutoPreview(
    delayMs: number,
    reason: ScheduledPreviewGenerationReason,
  ): void {
    this.cancelAutoPreview();
    this.pendingAutoPreviewReason = reason;
    this.autoPreviewTimer = window.setTimeout(() => {
      this.autoPreviewTimer = null;
      const pendingReason = this.pendingAutoPreviewReason;
      this.pendingAutoPreviewReason = null;
      if (!this.onAutoPreview || !pendingReason) {
        return;
      }

      void Promise.resolve(this.onAutoPreview({
        reason: pendingReason,
      })).catch(() => {
        // Preview scheduling failures should not break editor mutations.
      });
    }, delayMs);
  }

  public cancelAutoPreview(): void {
    if (this.autoPreviewTimer !== null) {
      window.clearTimeout(this.autoPreviewTimer);
      this.autoPreviewTimer = null;
    }
    this.pendingAutoPreviewReason = null;
  }

  private requestSyncAfterRender(): void {
    if (!this.onSyncAfterRender) {
      return;
    }

    void Promise.resolve(this.onSyncAfterRender()).catch(() => {
      // Render-sync failures should not block state persistence.
    });
  }

  private bumpChainRevision(): void {
    this.state.chainRevision += 1;
  }

  private persistChainState(): void {
    persistEditorChainState(this.state, () => this.requestSyncAfterRender());
  }

  public readBridgeSettings(): BridgeSettings {
    return readBridgeSettingsFromLabel(this.state.autoCreateLengthLabel);
  }

  public applyBridgeSettings(
    bridge: BridgeSettings,
    options: {
      persist?: boolean;
    } = {},
  ): void {
    applyEditorBridgeSettings(this.state, bridge, options);
  }

  public clearSelection(): void {
    this.rackBinding?.clearSelection();
  }

  public synchronizePersistedRackMetadata(
    metadata: AuthoredMetadata | undefined,
  ): void {
    const normalizedMetadata = normalizeAuthoredMetadata(metadata);
    const applyMetadata = (chain: GeneratorChain): GeneratorChain =>
      replaceAuthoredMetadata(chain, normalizedMetadata);
    this.state.chainState = applyMetadata(this.state.chainState);
    this.history.mapChains(applyMetadata);
  }

  public listUndoHistoryEntries(): EditorHistoryListEntry[] {
    return this.history.list();
  }

  private setClipboard(nextClipboard: RackClipboard | null): void {
    this.rackClipboard = nextClipboard;
    this.state.clipboardAvailable = nextClipboard !== null;
  }

  private persistChainMutation(
    nextChain: GeneratorChain,
    meta: ChainMutationMeta,
  ): void {
    commitEditorChainMutation(this.state, this.history, nextChain, meta, {
      bumpChainRevision: () => this.bumpChainRevision(),
      persistChainState: () => this.persistChainState(),
    });
  }

  private commitOutputMutation(
    nextChain: GeneratorChain,
    meta: ChainMutationMeta,
    previewMode: RackOutputPreviewMode = 'immediate',
  ): void {
    this.persistChainMutation(nextChain, meta);
    this.requestOutputPreview(previewMode === 'immediate' ? 0 : undefined);
  }

  private applyChainMutation(
    nextChain: GeneratorChain,
    meta: ChainMutationMeta,
  ): void {
    this.commitOutputMutation(nextChain, meta);
  }

  private replaceChainAndResetHistory(
    nextChain: GeneratorChain,
    meta: ChainMutationMeta,
  ): void {
    resetChainHistory(this.state, this.history, nextChain, meta, {
      bumpChainRevision: () => this.bumpChainRevision(),
      persistChainState: () => this.persistChainState(),
    });
    this.requestRegeneratedPreview('rack-load', 0);
  }

  private finishHistoryRestore(restored: boolean): boolean {
    if (restored) {
      this.requestOutputPreview(0);
    }
    return restored;
  }

  private undo(): boolean {
    return this.finishHistoryRestore(undoHistory(this.state, this.history, {
      bumpChainRevision: () => this.bumpChainRevision(),
      persistChainState: () => this.persistChainState(),
    }));
  }

  private redo(): boolean {
    return this.finishHistoryRestore(redoHistory(this.state, this.history, {
      bumpChainRevision: () => this.bumpChainRevision(),
      persistChainState: () => this.persistChainState(),
    }));
  }

  private checkoutHistory(targetId: string): boolean {
    return this.finishHistoryRestore(checkoutEditorHistory(this.state, this.history, targetId, {
      bumpChainRevision: () => this.bumpChainRevision(),
      persistChainState: () => this.persistChainState(),
    }));
  }

  private resolveContextSelection(target: ContextMenuTarget): RackSelectionSnapshot | null {
    return resolveEditorContextSelection(this.state, target);
  }

  private resolveCurrentSelection(): RackSelectionSnapshot | null {
    if (!this.rackBinding) {
      return null;
    }

    return resolveCurrentSelectionSnapshot(
      this.state.chainState,
      this.rackBinding.getSelectedGroupContexts(),
      this.rackBinding.getOrderedSelectedDeviceIds(),
    );
  }

  private copySelectionToClipboard(
    selectionOverride?: RackSelectionSnapshot | null,
  ): RackClipboard | null {
    return copySelectionToEditorClipboard(
      this.buildClipboardContext(),
      selectionOverride,
    );
  }

  private cutSelection(selectionOverride?: RackSelectionSnapshot | null): boolean {
    return cutEditorSelection(this.buildClipboardContext(), selectionOverride);
  }

  private pasteClipboard(
    clipboardOverride?: RackClipboard | null,
    selectionOverride?: RackSelectionSnapshot | null,
    meta: ChainMutationMeta = EDITOR_HISTORY_META.clipboardPaste,
  ): boolean {
    return pasteEditorClipboard(
      this.buildClipboardContext(),
      clipboardOverride,
      selectionOverride,
      meta,
    );
  }

  private duplicateSelection(selectionOverride?: RackSelectionSnapshot | null): boolean {
    return duplicateEditorSelection(this.buildClipboardContext(), selectionOverride);
  }

  private toggleRackSelectionEnabled(): boolean {
    const selection = this.resolveCurrentSelection();
    if (!selection) {
      return false;
    }
    const nextChain = toggleRackSelectionEnabled(this.state.chainState, selection);
    if (!nextChain) {
      return false;
    }

    this.applyChainMutation(nextChain, EDITOR_HISTORY_META.deviceToggleEnabled);
    return true;
  }

  private setSelectedDevicesCollapsed(collapsed: boolean): boolean {
    const selection = this.resolveCurrentSelection();
    if (!selection) {
      return false;
    }

    const selectedDeviceIds = selection.deviceIds;
    if (collapsed) {
      mergeCollapsedDeviceIds(this.state, selectedDeviceIds);
    } else {
      replaceCollapsedDeviceIds(
        this.state,
        this.state.collapsedDeviceIds.filter((id) => !selectedDeviceIds.includes(id)),
      );
    }
    return true;
  }

  private deleteDevicesById(
    deviceIds: readonly string[],
    meta: ChainMutationMeta = EDITOR_HISTORY_META.deleteDevices,
  ): boolean {
    return deleteEditorDevicesById(this.buildGroupingContext(), deviceIds, meta);
  }

  private deleteGroup(
    rawGroupId: string,
    meta: ChainMutationMeta = EDITOR_HISTORY_META.deleteDevices,
  ): boolean {
    return deleteEditorGroup(this.buildGroupingContext(), rawGroupId, meta);
  }

  private deleteCurrentSelection(): boolean {
    return deleteEditorSelection(this.buildGroupingContext());
  }

  private groupCurrentSelection(): boolean {
    return groupEditorSelection(this.buildGroupingContext());
  }

  private groupDeviceIds(targetIds: readonly string[]): boolean {
    return groupEditorDeviceIds(this.buildGroupingContext(), targetIds);
  }

  private beginRenameSelection(): boolean {
    const selection = this.resolveCurrentSelection();
    if (!selection || !this.rackBinding) {
      return false;
    }

    const selectedOnlyItem = selection.items.length === 1 ? selection.items[0] : null;
    if (selectedOnlyItem?.kind === 'group') {
      return this.rackBinding.startRenamingGroup(selectedOnlyItem.groupId);
    }

    if (selectedOnlyItem?.kind !== 'device') {
      return false;
    }

    return this.rackBinding.startRenamingDevice(selectedOnlyItem.deviceId);
  }

  private beginRenameFromContextTarget(target: ContextMenuTarget): boolean {
    if (!this.rackBinding) {
      return false;
    }

    if (!isRackSelectionContextTarget(target)) {
      return false;
    }

    if (target.kind === 'group') {
      return this.rackBinding.startRenamingGroup(target.groupId);
    }

    if (target.deviceIds.length !== 1) {
      return false;
    }

    return this.rackBinding.startRenamingDevice(target.deviceIds[0]);
  }

  private renameDevice(deviceId: string, rawName: string): boolean {
    const nextChain = renameDeviceById(this.state.chainState, deviceId, rawName);
    if (!nextChain) {
      return false;
    }

    this.persistChainMutation(nextChain, EDITOR_HISTORY_META.renameDevice);
    return true;
  }

  private renameGroup(groupId: string, rawName: string): boolean {
    const nextChain = renameGroupById(this.state.chainState, groupId, rawName);
    if (!nextChain) {
      return false;
    }

    this.persistChainMutation(nextChain, EDITOR_HISTORY_META.renameGroup);
    return true;
  }

  private updateDeviceInfo(deviceId: string, draft: AuthoredInfoDraft): boolean {
    const nextChain = updateDeviceAuthoredInfo(
      this.state.chainState,
      deviceId,
      draft,
    );
    if (!nextChain) {
      return false;
    }

    this.persistChainMutation(nextChain, EDITOR_HISTORY_META.editDeviceInfo);
    return true;
  }

  private updateGroupInfo(groupId: string, draft: AuthoredInfoDraft): boolean {
    const nextChain = updateGroupAuthoredInfo(
      this.state.chainState,
      groupId,
      draft,
    );
    if (!nextChain) {
      return false;
    }

    this.persistChainMutation(nextChain, EDITOR_HISTORY_META.editGroupInfo);
    return true;
  }

  private updateRackInfo(
    draft: Pick<AuthoredInfoDraft, 'author' | 'description'>,
  ): boolean {
    const nextChain = updateRackAuthoredMetadata(this.state.chainState, draft);
    if (!nextChain) {
      return false;
    }

    this.persistChainMutation(nextChain, EDITOR_HISTORY_META.editRackInfo);
    return true;
  }

  private selectInsertedDevices(
    previousChain: GeneratorChain,
    nextChain: GeneratorChain,
  ): void {
    const previousDeviceIds = previousChain.devices.map((device) => device.id);
    const insertedDeviceIds = nextChain.devices
      .filter((device) => !previousDeviceIds.includes(device.id))
      .map((device) => device.id);
    if (insertedDeviceIds.length === 0) {
      return;
    }

    this.rackBinding?.setSelectedDeviceIds(insertedDeviceIds);
  }

  private selectGroupIds(
    groupIds: readonly string[],
  ): void {
    if (groupIds.length === 0) {
      return;
    }

    this.rackBinding?.setSelectedGroupIds(groupIds);
  }

  private selectInsertedGroups(
    previousChain: GeneratorChain,
    nextChain: GeneratorChain,
  ): void {
    const previousGroupIds = buildOrderedGroupIds(previousChain.devices);
    const insertedGroupIds = buildOrderedGroupIds(nextChain.devices)
      .filter((groupId) => !previousGroupIds.includes(groupId));
    this.selectGroupIds(insertedGroupIds);
  }

  private selectInsertedRackItems(
    previousChain: GeneratorChain,
    nextChain: GeneratorChain,
  ): void {
    const previousDeviceIds = new SvelteSet(previousChain.devices.map((device) => device.id));
    const insertedDevices = nextChain.devices.filter((device) => !previousDeviceIds.has(device.id));
    if (insertedDevices.length === 0) {
      return;
    }

    const groupIds: string[] = [];
    const deviceIds: string[] = [];
    let anchor: RackSelectionItem | null = null;
    for (const device of insertedDevices) {
      const groupId = normalizeOptionalId(device.groupId);
      if (groupId) {
        if (!groupIds.includes(groupId)) {
          groupIds.push(groupId);
          anchor = { kind: 'group', id: groupId };
        }
        continue;
      }

      deviceIds.push(device.id);
      anchor = { kind: 'device', id: device.id };
    }

    this.rackBinding?.setSelectedRackItems(deviceIds, groupIds, anchor);
  }

  private insertDevicePreset(
    dropZone: RackDropZone,
    preset: DevicePresetFile,
  ): PresetApplyResult {
    const previousChain = this.state.chainState;
    const result = insertDevicePresetFile(
      previousChain,
      dropZone,
      preset,
      (kind) => allocateDeviceNodeId(kind),
    );
    if (!result.ok) {
      return result;
    }

    this.applyChainMutation(result.chain, EDITOR_HISTORY_META.insertDevicePreset);
    this.selectInsertedDevices(previousChain, result.chain);
    return result;
  }

  private insertGroupPreset(
    dropZone: RackDropZone,
    preset: GroupPresetFile,
  ): GroupPresetApplyResult {
    const previousChain = this.state.chainState;
    const result = insertGroupPresetFile(
      previousChain,
      dropZone,
      preset,
      (kind) => allocateDeviceNodeId(kind),
    );
    if (!result.ok) {
      return result;
    }

    this.applyChainMutation(result.chain, EDITOR_HISTORY_META.insertGroupPreset);
    mergeCollapsedDeviceIds(this.state, result.collapsedDeviceIds);
    this.selectGroupIds([result.groupId]);
    return result;
  }

  private applyRackPreset(preset: RackPresetFile): RackPresetApplyResult {
    const result = applyRackPresetFile(preset);
    if (!result.ok) {
      return result;
    }

    this.rackBinding?.clearSelection();
    this.replaceChainAndResetHistory(result.chain, EDITOR_HISTORY_META.loadRackPreset);
    replaceCollapsedDeviceIds(this.state, result.collapsedDeviceIds);
    return result;
  }

  private ungroupGroup(
    rawGroupId: string,
    meta: ChainMutationMeta = EDITOR_HISTORY_META.groupUngroup,
  ): boolean {
    return ungroupEditorGroup(this.buildGroupingContext(), rawGroupId, meta);
  }

  private ungroupSelectedGroups(): boolean {
    return ungroupEditorSelections(this.buildGroupingContext());
  }

  private buildGroupingContext() {
    return {
      state: this.state,
      rackBinding: this.rackBinding,
      applyChainMutation: (
        nextChain: EditorSessionState['chainState'],
        meta: ChainMutationMeta,
      ) => this.applyChainMutation(nextChain, meta),
    };
  }

  private buildClipboardContext() {
    return {
      state: this.state,
      rackBinding: this.rackBinding,
      getClipboard: () => this.rackClipboard,
      setClipboard: (clipboard: RackClipboard | null) => {
        this.setClipboard(clipboard);
      },
      applyChainMutation: (
        nextChain: EditorSessionState['chainState'],
        meta: ChainMutationMeta,
      ) => this.applyChainMutation(nextChain, meta),
      deleteDevicesById: (
        deviceIds: readonly string[],
        meta?: ChainMutationMeta,
      ) => this.deleteDevicesById(deviceIds, meta),
      applyInsertedSelection: (
        clipboard: RackClipboard,
        previousChain: EditorSessionState['chainState'],
        nextChain: EditorSessionState['chainState'],
        collapsedDeviceIds: readonly string[],
      ) => {
        mergeCollapsedDeviceIds(this.state, collapsedDeviceIds);
        if (clipboard.kind === 'group') {
          this.selectInsertedGroups(previousChain, nextChain);
          return;
        }

        if (clipboard.kind === 'rack-items') {
          this.selectInsertedRackItems(previousChain, nextChain);
          return;
        }

        this.selectInsertedDevices(previousChain, nextChain);
      },
    };
  }
}

export const createEditorSession = (
  options?: EditorSessionOptions,
): EditorSession => new EditorSession(options);
