import type { BridgeSettings } from '../../../shared/bridge/types';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';
import type { RendererDeviceKind } from '../../../devices';
import { isRendererDeviceKind } from '../../../devices';
import type { ContextMenuTarget } from '../../components/context-menu-types';
import type { RackInteractionCommit } from '../../components/device-rack-types';
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
  type EditorHistory,
  type EditorHistoryListEntry,
} from './editor-history';
import {
  applyChainMutation as applyEditorChainMutation,
  checkoutHistory as checkoutEditorHistory,
  getCurrentHistoryEntry,
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
  reconcileCurrentChainModulators as reconcileEditorChainModulators,
  toggleCollapse,
} from './persistence';
import type { RackClipboard } from './rack-clipboard';
import type { ChainMutationMeta } from './history-core';
import type { RackSelectionSnapshot } from './selectors';

const DEFAULT_AUTO_PREVIEW_DEBOUNCE_MS = 120;
const DEFAULT_HISTORY_MAX_ENTRIES = 100;

export interface EditorSessionState {
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
  previewPlayLabel: string;
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
  applyNextSelectionAfterDelete(deviceIds: readonly string[]): void;
  clearSelection(): void;
  syncAfterRender(): void;
  handleBrowserPointerDown(
    event: PointerEvent,
    kind: RendererDeviceKind,
    itemEl: HTMLElement,
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

  public readonly commands = {
    initialize: (): void => {
      initializeHistoryBridge(this.state, this.history, {
        reconcileCurrentChainModulators: () => this.reconcileCurrentChainModulators(),
        bumpChainRevision: () => this.bumpChainRevision(),
        requestSyncAfterRender: () => this.requestSyncAfterRender(),
      });
    },
    dispose: (): void => {
      this.cancelAutoPreview();
      this.history.flushPendingMerge();
    },
    attachRackBinding: (binding: EditorRackBinding | null): void => {
      this.rackBinding = binding;
    },
    scheduleAutoPreview: (delayMs?: number): void => {
      this.scheduleAutoPreview(delayMs);
    },
    cancelAutoPreview: (): void => {
      this.cancelAutoPreview();
    },
    openSettings: (): void => {
      this.state.isSettingsOpen = true;
    },
    closeSettings: (): void => {
      this.state.isSettingsOpen = false;
    },
    persistSidebarWidth: (nextWidth?: number): void => {
      persistSidebarWidth(this.state, nextWidth);
    },
    toggleCollapse: (id: string): void => {
      toggleCollapse(this.state, id);
    },
    saveChain: (chain: GeneratorChain, meta: ChainMutationMeta): void => {
      saveChainWithHistory(this.state, this.history, chain, meta, {
        bumpChainRevision: () => this.bumpChainRevision(),
        persistChainState: () => this.persistChainState(),
      });
    },
    addBrowserDevice: (kind: RendererDeviceKind): void => {
      if (!isRendererDeviceKind(kind)) {
        return;
      }

      this.applyChainMutation(
        applyBrowserDeviceAdd(this.state.chainState, kind),
        EDITOR_HISTORY_META.addDevice,
      );
    },
    handleBrowserPointerDown: (payload: {
      kind: RendererDeviceKind;
      sourceEvent: PointerEvent;
      itemEl: HTMLElement;
    }): void => {
      this.rackBinding?.handleBrowserPointerDown(
        payload.sourceEvent,
        payload.kind,
        payload.itemEl,
      );
    },
    handleRackCommit: (commit: RackInteractionCommit): void => {
      const nextChain = applyRackCommit(this.state.chainState, commit);
      if (!nextChain) {
        return;
      }

      this.applyChainMutation(
        nextChain,
        commit.kind === 'move'
          ? EDITOR_HISTORY_META.moveDevices
          : EDITOR_HISTORY_META.insertDevice,
      );
    },
    toggleGroupEnabled: (groupId: string, nextEnabled: boolean): void => {
      toggleEditorGroupEnabled(this.buildGroupingContext(), groupId, nextEnabled);
    },
    handleAutoCreateLengthChange: (): void => {
      handleAutoCreateLengthChange(this.state, (delayMs) => this.scheduleAutoPreview(delayMs));
    },
    undo: (): boolean => this.undo(),
    redo: (): boolean => this.redo(),
    listHistory: (): EditorHistoryListEntry[] => this.history.list(),
    getCurrentHistoryEntry: (): EditorHistoryListEntry | null =>
      getCurrentHistoryEntry(this.history),
    checkoutHistory: (target: string | number): boolean => this.checkoutHistory(target),
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
    deleteFromContextTarget: (target: ContextMenuTarget): void => {
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
      this.copySelectionToClipboard(this.resolveContextSelection(target));
    },
    cutFromContextTarget: (target: ContextMenuTarget): void => {
      this.cutSelection(this.resolveContextSelection(target));
    },
    pasteFromContextTarget: (target: ContextMenuTarget): void => {
      this.pasteClipboard(undefined, this.resolveContextSelection(target));
    },
    duplicateFromContextTarget: (target: ContextMenuTarget): void => {
      this.duplicateSelection(this.resolveContextSelection(target));
    },
    groupDeviceIds: (targetIds: string[]): void => {
      this.groupDeviceIds(targetIds);
    },
    ungroupGroup: (groupId: string): void => {
      this.ungroupGroup(groupId, EDITOR_HISTORY_META.groupUngroup);
    },
    clearSelection: (): void => {
      this.rackBinding?.clearSelection();
    },
    setLaunchpadModelEnabled: (nextEnabled: boolean): boolean =>
      setLaunchpadModelEnabled(this.state, nextEnabled, (delayMs) => this.scheduleAutoPreview(delayMs)),
    togglePreviewLoopEnabled: (): boolean => togglePreviewLoopEnabled(this.state),
    setPreviewGuideEnabled: (nextEnabled: boolean): boolean =>
      setPreviewGuideEnabled(this.state, nextEnabled),
    setPreviewPopoutOpen: (nextEnabled: boolean): void => {
      this.state.isPreviewPopoutOpen = nextEnabled;
    },
    setPreviewPlaying: (nextIsPlaying: boolean): void => {
      this.state.previewPlayLabel = nextIsPlaying ? 'Pause' : 'Play';
    },
    syncPreviewBpm: (nextBpm: number): boolean => syncPreviewBpm(this.state, nextBpm),
    setPreviewLoopLengthBeats: (nextBeats: number): void => {
      this.state.previewLoopLengthBeats = nextBeats;
    },
    setPaletteNameText: (nameText: string): void => {
      this.state.paletteNameText = nameText;
    },
    setHeaderIndicatorText: (text: string): void => {
      this.state.headerIndicatorText = text;
    },
    clearHeaderIndicatorText: (): void => {
      this.state.headerIndicatorText = '';
    },
    setSendButtonState: (label: string, disabled: boolean): void => {
      this.state.sendButtonLabel = label;
      this.state.sendButtonDisabled = disabled;
    },
    readBridgeSettings: (): BridgeSettings => this.readBridgeSettings(),
    applyBridgeSettings: (
      bridge: BridgeSettings,
      options: {
        persist?: boolean;
      } = {},
    ): void => {
      applyEditorBridgeSettings(this.state, bridge, options);
    },
  };

  private scheduleAutoPreview(delayMs = this.autoPreviewDebounceMs): void {
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

  private cancelAutoPreview(): void {
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

  private reconcileCurrentChainModulators(): boolean {
    return reconcileEditorChainModulators(this.state);
  }

  private persistChainState(): void {
    persistEditorChainState(this.state, () => this.requestSyncAfterRender());
  }

  private readBridgeSettings(): BridgeSettings {
    return readBridgeSettingsFromLabel(this.state.autoCreateLengthLabel);
  }

  private setClipboard(nextClipboard: RackClipboard | null): void {
    this.rackClipboard = nextClipboard;
    this.state.clipboardAvailable = nextClipboard !== null;
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

  private checkoutHistory(target: string | number): boolean {
    return checkoutEditorHistory(this.state, this.history, target, {
      bumpChainRevision: () => this.bumpChainRevision(),
      persistChainState: () => this.persistChainState(),
      scheduleAutoPreview: (delayMs) => this.scheduleAutoPreview(delayMs),
    });
  }

  private resolveContextSelection(target: ContextMenuTarget): RackSelectionSnapshot | null {
    return resolveEditorContextSelection(this.state, target);
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
    };
  }
}

export const createEditorSession = (
  options?: EditorSessionOptions,
): EditorSession => new EditorSession(options);
