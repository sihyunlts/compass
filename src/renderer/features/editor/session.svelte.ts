import type { BridgeSettings } from '../../../shared/bridge/types';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';
import type {
  DevicePresetFile,
  GroupPresetFile,
  RackPresetFile,
} from '../../../shared/presets';
import type { RendererDeviceKind } from '../../../devices';
import { isRendererDeviceKind } from '../../../devices';
import type { ContextMenuTarget } from '../../components/context-menu-types';
import type {
  BrowserInsertSource,
  BrowserPresetInsertSource,
  RackInteractionCommit,
} from '../../components/device-rack-types';
import type { RackDropZone } from '../rack/drop-ops';
import type { GroupSelectionContext } from '../rack/selection.svelte';
import {
  applyBridgeSettings as applyEditorBridgeSettings,
  handleAutoCreateLengthChange,
  readBridgeSettingsFromLabel,
  setLaunchpadModelEnabled,
  setPreviewGuideEnabled,
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
} from './commands';
import {
  createEditorHistory,
  type EditorHistoryListEntry,
  type EditorHistory,
} from './editor-history';
import {
  applyChainMutation as applyEditorChainMutation,
  checkoutHistory as checkoutEditorHistory,
  initializeHistoryBridge,
  redoHistory,
  saveChainWithHistory,
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
  ungroupGroup as ungroupEditorGroup,
  ungroupSelectedGroups as ungroupEditorSelections,
} from './grouping';
import {
  createInitialEditorState,
  persistChainState as persistEditorChainState,
  persistSidebarWidth,
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
  applyRackPresetFile,
  type GroupPresetApplyResult,
  insertDevicePresetFile,
  insertGroupPresetFile,
  type PresetApplyResult,
} from './presets';
import type { RackClipboard } from './rack-clipboard';
import type { ChainMutationMeta } from './history-core';
import {
  resolveCurrentSelectionSnapshot,
  type RackSelectionSnapshot,
} from './selectors';

const DEFAULT_AUTO_PREVIEW_DEBOUNCE_MS = 120;
const DEFAULT_HISTORY_MAX_ENTRIES = 100;

export interface EditorSessionState {
  sidebarPage: 'devices' | 'presets';
  chainState: GeneratorChain;
  chainRevision: number;
  launchpadModel: LaunchpadModel;
  headerIndicatorText: string;
  paletteNameText: string;
  isSettingsOpen: boolean;
  previewBpm: number;
  previewLoopLengthBeats: number;
  isPreviewLoopEnabled: boolean;
  isPreviewGuideEnabled: boolean;
  isPreviewPopoutOpen: boolean;
  previewScrubValue: number;
  autoCreateLengthLabel: string;
  sendButtonLabel: string;
  sendButtonDisabled: boolean;
  sidebarWidthPx: number;
  isSidebarResizing: boolean;
  collapsedDeviceIds: string[];
  clipboardAvailable: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoActionLabel: string;
  redoActionLabel: string;
}

export interface EditorRackBinding {
  getSelectedGroupContexts(): GroupSelectionContext[];
  getOrderedSelectedDeviceIds(): string[];
  selectAllDevices(ids: string[]): void;
  setSelectedDeviceIds(
    ids: readonly string[],
    orderedDeviceIds?: readonly string[],
  ): void;
  setSelectedGroupIds(
    ids: readonly string[],
    orderedGroupIds?: readonly string[],
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

interface EditorSessionOptions {
  autoPreviewDebounceMs?: number;
  historyMaxEntries?: number;
  onAutoPreview?: () => void | Promise<void>;
  onSyncAfterRender?: () => void | Promise<void>;
}

export class EditorSession {
  public readonly state: EditorSessionState = $state(createInitialEditorState());

  private readonly history: EditorHistory;

  private readonly autoPreviewDebounceMs: number;

  private readonly onAutoPreview: (() => void | Promise<void>) | null;

  private readonly onSyncAfterRender: (() => void | Promise<void>) | null;

  private autoPreviewTimer: number | null = null;

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
    saveChain: (chain: GeneratorChain, meta: ChainMutationMeta): void => {
      this.persistChainMutation(chain, meta);
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
      source: BrowserPresetInsertSource,
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
          : EDITOR_HISTORY_META.insertDevice,
      );
      if (commit.kind === 'insert-device') {
        this.selectInsertedDevices(previousChain, nextChain);
      }
    },
    toggleGroupEnabled: (groupId: string, nextEnabled: boolean): void => {
      toggleEditorGroupEnabled(this.buildGroupingContext(), groupId, nextEnabled);
    },
    handleAutoCreateLengthChange: (): void => {
      handleAutoCreateLengthChange(this.state, (delayMs) => this.scheduleAutoPreview(delayMs));
    },
    undo: (): boolean => this.undo(),
    redo: (): boolean => this.redo(),
    checkoutHistory: (targetId: string): boolean => this.checkoutHistory(targetId),
    copySelection: (): boolean => this.copySelectionToClipboard() !== null,
    cutSelection: (): boolean => this.cutSelection(),
    pasteClipboard: (): boolean => this.pasteClipboard(),
    duplicateSelection: (): boolean => this.duplicateSelection(),
    selectAllRackDevices: (): boolean => {
      const rackBinding = this.rackBinding;
      if (!rackBinding) {
        return false;
      }

      rackBinding.selectAllDevices(
        this.state.chainState.devices.map((device) => device.id),
      );
      return true;
    },
    deleteSelection: (): boolean => this.deleteCurrentSelection(),
    groupSelection: (): boolean => this.groupCurrentSelection(),
    ungroupSelectedGroups: (): boolean => this.ungroupSelectedGroups(),
    beginRenameSelection: (): boolean => this.beginRenameSelection(),
    deleteFromContextTarget: (target: ContextMenuTarget): void => {
      if (target.kind === 'preset-entry' || target.kind === 'presets-root') {
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
      if (target.kind === 'preset-entry' || target.kind === 'presets-root') {
        return;
      }

      this.copySelectionToClipboard(this.resolveContextSelection(target));
    },
    cutFromContextTarget: (target: ContextMenuTarget): void => {
      if (target.kind === 'preset-entry' || target.kind === 'presets-root') {
        return;
      }

      this.cutSelection(this.resolveContextSelection(target));
    },
    pasteFromContextTarget: (target: ContextMenuTarget): void => {
      if (target.kind === 'preset-entry' || target.kind === 'presets-root') {
        return;
      }

      this.pasteClipboard(undefined, this.resolveContextSelection(target));
    },
    duplicateFromContextTarget: (target: ContextMenuTarget): void => {
      if (target.kind === 'preset-entry' || target.kind === 'presets-root') {
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
    insertDevicePreset: (
      dropZone: RackDropZone,
      preset: DevicePresetFile,
    ): PresetApplyResult => this.insertDevicePreset(dropZone, preset),
    insertGroupPreset: (
      dropZone: RackDropZone,
      preset: GroupPresetFile,
    ): GroupPresetApplyResult => this.insertGroupPreset(dropZone, preset),
    applyRackPreset: (
      preset: RackPresetFile,
    ): PresetApplyResult => this.applyRackPreset(preset),
    setLaunchpadModelEnabled: (nextEnabled: boolean): boolean =>
      setLaunchpadModelEnabled(this.state, nextEnabled, (delayMs) => this.scheduleAutoPreview(delayMs)),
    togglePreviewLoopEnabled: (): boolean => togglePreviewLoopEnabled(this.state),
    setPreviewGuideEnabled: (nextEnabled: boolean): boolean =>
      setPreviewGuideEnabled(this.state, nextEnabled),
    syncPreviewBpm: (nextBpm: number): boolean => syncPreviewBpm(this.state, nextBpm),
  };

  public scheduleAutoPreview(delayMs = this.autoPreviewDebounceMs): void {
    this.cancelAutoPreview();
    this.autoPreviewTimer = window.setTimeout(() => {
      this.autoPreviewTimer = null;
      if (!this.onAutoPreview) {
        return;
      }

      void Promise.resolve(this.onAutoPreview()).catch(() => {
        // Preview scheduling failures should not break editor mutations.
      });
    }, delayMs);
  }

  public cancelAutoPreview(): void {
    if (this.autoPreviewTimer === null) {
      return;
    }

    window.clearTimeout(this.autoPreviewTimer);
    this.autoPreviewTimer = null;
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
    saveChainWithHistory(this.state, this.history, nextChain, meta, {
      bumpChainRevision: () => this.bumpChainRevision(),
      persistChainState: () => this.persistChainState(),
    });
  }

  private applyChainMutation(
    nextChain: GeneratorChain,
    meta: ChainMutationMeta,
  ): void {
    applyEditorChainMutation(this.state, this.history, nextChain, meta, {
      bumpChainRevision: () => this.bumpChainRevision(),
      persistChainState: () => this.persistChainState(),
      scheduleAutoPreview: (delayMs) => this.scheduleAutoPreview(delayMs),
    });
  }

  private undo(): boolean {
    return undoHistory(this.state, this.history, {
      bumpChainRevision: () => this.bumpChainRevision(),
      persistChainState: () => this.persistChainState(),
      scheduleAutoPreview: (delayMs) => this.scheduleAutoPreview(delayMs),
    });
  }

  private redo(): boolean {
    return redoHistory(this.state, this.history, {
      bumpChainRevision: () => this.bumpChainRevision(),
      persistChainState: () => this.persistChainState(),
      scheduleAutoPreview: (delayMs) => this.scheduleAutoPreview(delayMs),
    });
  }

  private checkoutHistory(targetId: string): boolean {
    return checkoutEditorHistory(this.state, this.history, targetId, {
      bumpChainRevision: () => this.bumpChainRevision(),
      persistChainState: () => this.persistChainState(),
      scheduleAutoPreview: (delayMs) => this.scheduleAutoPreview(delayMs),
    });
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

    if (selection.kind === 'group') {
      return this.rackBinding.startRenamingGroup(selection.groupId);
    }

    if (selection.deviceIds.length !== 1) {
      return false;
    }

    return this.rackBinding.startRenamingDevice(selection.deviceIds[0]);
  }

  private beginRenameFromContextTarget(target: ContextMenuTarget): boolean {
    if (!this.rackBinding) {
      return false;
    }

    if (target.kind === 'preset-entry' || target.kind === 'presets-root') {
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

    this.rackBinding?.setSelectedDeviceIds(
      insertedDeviceIds,
      nextChain.devices.map((device) => device.id),
    );
  }

  private selectGroupIds(
    groupIds: readonly string[],
    chain: GeneratorChain,
  ): void {
    if (groupIds.length === 0) {
      return;
    }

    this.rackBinding?.setSelectedGroupIds(
      groupIds,
      buildOrderedGroupIds(chain.devices),
    );
  }

  private selectInsertedGroups(
    previousChain: GeneratorChain,
    nextChain: GeneratorChain,
  ): void {
    const previousGroupIds = buildOrderedGroupIds(previousChain.devices);
    const insertedGroupIds = buildOrderedGroupIds(nextChain.devices)
      .filter((groupId) => !previousGroupIds.includes(groupId));
    this.selectGroupIds(insertedGroupIds, nextChain);
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
    this.selectGroupIds([result.groupId], result.chain);
    return result;
  }

  private applyRackPreset(
    preset: RackPresetFile,
  ): PresetApplyResult {
    const result = applyRackPresetFile(preset);
    if (!result.ok) {
      return result;
    }

    this.rackBinding?.clearSelection();
    this.applyChainMutation(result.chain, EDITOR_HISTORY_META.loadRackPreset);
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
      deleteGroup: (
        groupId: string,
        meta?: ChainMutationMeta,
      ) => this.deleteGroup(groupId, meta),
      applyInsertedSelection: (
        clipboard: RackClipboard,
        previousChain: EditorSessionState['chainState'],
        nextChain: EditorSessionState['chainState'],
      ) => {
        if (clipboard.kind === 'group') {
          this.selectInsertedGroups(previousChain, nextChain);
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
