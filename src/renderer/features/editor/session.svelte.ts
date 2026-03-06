import {
  AUTO_CREATE_LENGTH_OPTIONS,
  parseBeatsValue,
  toLengthPresetLabel,
} from '../../../shared/beat-length';
import { sanitizePreviewBpm } from '../../services/storage';
import type { GeneratorChain, LaunchpadModel } from '../../../shared/model';
import type { BridgeSettings } from '../../../shared/bridge';
import type { RackInteractionCommit } from '../../components/device-rack-types';
import type { BrowserDeviceKind } from '../../services/devices';
import { isBrowserDeviceKind } from '../../services/devices';
import type { RackClipboard } from '../../services/rack-clipboard';
import {
  loadBridgeSettings,
  loadChainSettings,
  loadCollapsedDeviceIds,
  loadLaunchpadModel,
  loadPreviewBpm,
  loadPreviewGuideEnabled,
  loadPreviewLoopEnabled,
  loadSidebarWidth,
  saveBridgeSettings,
  saveChainSettings,
  saveCollapsedDeviceIds,
  saveLaunchpadModel,
  savePreviewBpm,
  savePreviewGuideEnabled,
  savePreviewLoopEnabled,
  saveSidebarWidth,
  sanitizeBridgeSettings,
} from '../../services/storage';
import type { GroupSelectionContext } from '../rack/selection.svelte';
import {
  assignGroupIdToDevices,
  canCreateGroupFromSelection,
  removeDevicesById,
  resolveGroupMemberIds,
  resolveNextGroupId,
  withDevices,
} from '../../state/chain';
import { reconcileGeneratorChainModulators } from '../../../core/modulation/routing';
import type { ChainMutationMeta } from '../../state/chain-history';
import type { ContextMenuTarget } from '../../state/context-menu';
import {
  EDITOR_HISTORY_META,
  applyBrowserDeviceAdd,
  applyGroupEnabledChange,
  applyRackCommit,
  buildChainWithClipboardPaste,
  buildClipboardFromSelection,
} from './commands';
import {
  createEditorHistory,
  type EditorHistory,
} from './editor-history';
import {
  resolveCurrentSelectionSnapshot,
  resolveDeleteSelectionDeviceIds,
  resolveSelectionSnapshotFromContextTarget,
  type RackSelectionSnapshot,
} from './selectors';

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
    kind: BrowserDeviceKind,
    itemEl: HTMLElement,
  ): void;
}

interface EditorSessionOptions {
  autoPreviewDebounceMs?: number;
  historyMaxEntries?: number;
  onAutoPreview?: () => void | Promise<void>;
  onSyncAfterRender?: () => void | Promise<void>;
}

const readBridgeSettingsFromLabel = (lengthLabel: string): BridgeSettings =>
  sanitizeBridgeSettings({
    autoCreateLengthBeats: parseBeatsValue(lengthLabel),
  });

const resolveBridgeLengthLabel = (bridge: BridgeSettings): string =>
  toLengthPresetLabel(bridge.autoCreateLengthBeats, AUTO_CREATE_LENGTH_OPTIONS[0].label);

const createInitialEditorState = (): EditorSessionState => {
  const bridge = loadBridgeSettings();
  return {
    chainState: loadChainSettings(),
    chainRevision: 1,
    launchpadModel: loadLaunchpadModel(),
    headerIndicatorText: '',
    paletteNameText: 'Default palette: loading...',
    isSettingsOpen: false,
    previewBpm: loadPreviewBpm(),
    previewLoopLengthBeats: bridge.autoCreateLengthBeats,
    isPreviewLoopEnabled: loadPreviewLoopEnabled(),
    isPreviewGuideEnabled: loadPreviewGuideEnabled(),
    isPreviewPopoutOpen: false,
    previewScrubValue: 0,
    autoCreateLengthLabel: resolveBridgeLengthLabel(bridge),
    previewPlayLabel: 'Play',
    sendButtonLabel: 'Send',
    sendButtonDisabled: false,
    sidebarWidthPx: loadSidebarWidth(),
    isSidebarResizing: false,
    collapsedDeviceIds: loadCollapsedDeviceIds(),
    clipboardAvailable: false,
    canUndo: false,
    canRedo: false,
    undoActionLabel: 'Undo',
    redoActionLabel: 'Redo',
  };
};

export class EditorSession {
  public readonly state: EditorSessionState = $state(createInitialEditorState());

  public readonly history: EditorHistory;

  private readonly autoPreviewDebounceMs: number;

  private readonly onAutoPreview: (() => void | Promise<void>) | null;

  private readonly onSyncAfterRender: (() => void | Promise<void>) | null;

  private autoPreviewTimer: number | null = null;

  private rackBinding: EditorRackBinding | null = null;

  private rackClipboard: RackClipboard | null = null;

  constructor(options: EditorSessionOptions = {}) {
    this.history = createEditorHistory(this.state.chainState, {
      maxEntries: options.historyMaxEntries ?? DEFAULT_HISTORY_MAX_ENTRIES,
    });
    this.autoPreviewDebounceMs = options.autoPreviewDebounceMs ?? DEFAULT_AUTO_PREVIEW_DEBOUNCE_MS;
    this.onAutoPreview = options.onAutoPreview ?? null;
    this.onSyncAfterRender = options.onSyncAfterRender ?? null;
    this.syncHistoryState();
  }

  public readonly commands = {
    initialize: (): void => {
      if (this.reconcileCurrentChainModulators()) {
        this.bumpChainRevision();
      }
      this.history.replaceCurrent(this.state.chainState);
      this.syncHistoryState();
      this.requestSyncAfterRender();
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
      saveSidebarWidth(nextWidth ?? this.state.sidebarWidthPx);
    },
    toggleCollapse: (id: string): void => {
      const next = this.state.collapsedDeviceIds.includes(id)
        ? this.state.collapsedDeviceIds.filter((item) => item !== id)
        : [...this.state.collapsedDeviceIds, id];
      this.state.collapsedDeviceIds = next;
      saveCollapsedDeviceIds(next);
    },
    saveChain: (chain: GeneratorChain, meta: ChainMutationMeta): void => {
      this.state.chainState = chain;
      this.bumpChainRevision();
      this.persistChainState();
      this.history.push(chain, meta);
      this.syncHistoryState();
    },
    addBrowserDevice: (kind: BrowserDeviceKind): void => {
      if (!isBrowserDeviceKind(kind)) {
        return;
      }
      this.applyChainMutation(
        applyBrowserDeviceAdd(this.state.chainState, kind),
        EDITOR_HISTORY_META.addDevice,
      );
    },
    handleBrowserPointerDown: (payload: {
      kind: BrowserDeviceKind;
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
      const nextChain = applyGroupEnabledChange(
        this.state.chainState,
        groupId,
        nextEnabled,
      );
      if (!nextChain) {
        return;
      }
      this.applyChainMutation(nextChain, EDITOR_HISTORY_META.groupToggleEnabled);
    },
    handleAutoCreateLengthChange: (): void => {
      const bridge = this.readBridgeSettings();
      this.state.previewLoopLengthBeats = bridge.autoCreateLengthBeats;
      saveBridgeSettings(bridge);
      this.scheduleAutoPreview(0);
    },
    undo: (): boolean => this.undo(),
    redo: (): boolean => this.redo(),
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
    setLaunchpadModelEnabled: (nextEnabled: boolean): boolean => {
      const nextModel: LaunchpadModel = nextEnabled ? 'mk2' : 'mk3';
      if (this.state.launchpadModel === nextModel) {
        return false;
      }
      this.state.launchpadModel = nextModel;
      saveLaunchpadModel(nextModel);
      this.scheduleAutoPreview(0);
      return true;
    },
    togglePreviewLoopEnabled: (): boolean => {
      this.state.isPreviewLoopEnabled = !this.state.isPreviewLoopEnabled;
      savePreviewLoopEnabled(this.state.isPreviewLoopEnabled);
      return true;
    },
    setPreviewGuideEnabled: (nextEnabled: boolean): boolean => {
      if (this.state.isPreviewGuideEnabled === nextEnabled) {
        return false;
      }
      this.state.isPreviewGuideEnabled = nextEnabled;
      savePreviewGuideEnabled(nextEnabled);
      return true;
    },
    setPreviewPopoutOpen: (nextEnabled: boolean): void => {
      this.state.isPreviewPopoutOpen = nextEnabled;
    },
    setPreviewPlaying: (nextIsPlaying: boolean): void => {
      this.state.previewPlayLabel = nextIsPlaying ? 'Pause' : 'Play';
    },
    syncPreviewBpm: (nextBpm: number): boolean => {
      const sanitized = sanitizePreviewBpm(nextBpm);
      if (Math.abs(sanitized - this.state.previewBpm) < 0.0001) {
        return false;
      }
      this.state.previewBpm = sanitized;
      savePreviewBpm(sanitized);
      return true;
    },
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
      this.state.autoCreateLengthLabel = resolveBridgeLengthLabel(bridge);
      this.state.previewLoopLengthBeats = bridge.autoCreateLengthBeats;
      if (options.persist === true) {
        saveBridgeSettings(bridge);
      }
    },
  };

  private syncHistoryState(): void {
    this.state.canUndo = this.history.canUndo();
    this.state.canRedo = this.history.canRedo();
    this.state.undoActionLabel = this.history.getUndoEntry()?.label ?? 'Undo';
    this.state.redoActionLabel = this.history.getRedoEntry()?.label ?? 'Redo';
  }

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
    const changed = reconcileGeneratorChainModulators(this.state.chainState);
    if (!changed) {
      return false;
    }
    this.state.chainState = withDevices(
      this.state.chainState,
      [...this.state.chainState.devices],
    );
    return true;
  }

  private pruneCollapsedDeviceIds(): void {
    const validIds = this.state.chainState.devices.map((device) => device.id);
    const next = this.state.collapsedDeviceIds.filter((id) => validIds.includes(id));
    if (next.length === this.state.collapsedDeviceIds.length) {
      return;
    }
    this.state.collapsedDeviceIds = next;
    saveCollapsedDeviceIds(next);
  }

  private persistChainState(): void {
    this.reconcileCurrentChainModulators();
    this.pruneCollapsedDeviceIds();
    saveChainSettings(this.state.chainState);
    this.requestSyncAfterRender();
  }

  private onChainMutated(meta: ChainMutationMeta): void {
    this.persistChainState();
    this.bumpChainRevision();
    this.history.push(this.state.chainState, meta);
    this.syncHistoryState();
  }

  private applyChainMutation(
    nextChain: GeneratorChain,
    meta: ChainMutationMeta,
  ): void {
    this.state.chainState = nextChain;
    this.onChainMutated(meta);
    this.scheduleAutoPreview(0);
  }

  private restoreChainFromHistory(chain: GeneratorChain): void {
    this.state.chainState = chain;
    this.persistChainState();
    this.bumpChainRevision();
    this.history.replaceCurrent(this.state.chainState);
    this.syncHistoryState();
    this.scheduleAutoPreview(0);
  }

  private undo(): boolean {
    const restored = this.history.undo();
    this.syncHistoryState();
    if (!restored) {
      return false;
    }
    this.restoreChainFromHistory(restored);
    return true;
  }

  private redo(): boolean {
    const restored = this.history.redo();
    this.syncHistoryState();
    if (!restored) {
      return false;
    }
    this.restoreChainFromHistory(restored);
    return true;
  }

  private readBridgeSettings(): BridgeSettings {
    return readBridgeSettingsFromLabel(this.state.autoCreateLengthLabel);
  }

  private setClipboard(nextClipboard: RackClipboard | null): void {
    this.rackClipboard = nextClipboard;
    this.state.clipboardAvailable = nextClipboard !== null;
  }

  private getCurrentSelectionSnapshot(): RackSelectionSnapshot | null {
    const rackBinding = this.rackBinding;
    if (!rackBinding) {
      return null;
    }

    return resolveCurrentSelectionSnapshot(
      this.state.chainState,
      rackBinding.getSelectedGroupContexts(),
      rackBinding.getOrderedSelectedDeviceIds(),
    );
  }

  private resolveActionSelection(
    selectionOverride?: RackSelectionSnapshot | null,
  ): RackSelectionSnapshot | null {
    return selectionOverride ?? this.getCurrentSelectionSnapshot();
  }

  private resolveContextSelection(target: ContextMenuTarget): RackSelectionSnapshot | null {
    return resolveSelectionSnapshotFromContextTarget(this.state.chainState, target);
  }

  private deleteDevicesById(
    deviceIds: readonly string[],
    meta: ChainMutationMeta = EDITOR_HISTORY_META.deleteDevices,
  ): boolean {
    this.rackBinding?.applyNextSelectionAfterDelete(deviceIds);
    const nextChain = removeDevicesById(this.state.chainState, deviceIds);
    if (!nextChain) {
      return false;
    }
    this.applyChainMutation(nextChain, meta);
    return true;
  }

  private deleteGroup(
    rawGroupId: string,
    meta: ChainMutationMeta = EDITOR_HISTORY_META.deleteDevices,
  ): boolean {
    const memberIds = resolveGroupMemberIds(this.state.chainState.devices, rawGroupId);
    if (memberIds.length === 0) {
      return false;
    }
    return this.deleteDevicesById(memberIds, meta);
  }

  private setGroupIdForDevices(
    deviceIds: readonly string[],
    groupId: string | null,
    meta: ChainMutationMeta,
  ): boolean {
    const nextChain = assignGroupIdToDevices(this.state.chainState, deviceIds, groupId);
    if (!nextChain) {
      return false;
    }
    this.applyChainMutation(nextChain, meta);
    return true;
  }

  private ungroupGroup(
    rawGroupId: string,
    meta: ChainMutationMeta = EDITOR_HISTORY_META.groupUngroup,
  ): boolean {
    const memberIds = resolveGroupMemberIds(this.state.chainState.devices, rawGroupId);
    if (memberIds.length === 0) {
      return false;
    }
    return this.setGroupIdForDevices(memberIds, null, meta);
  }

  private copySelectionToClipboard(
    selectionOverride?: RackSelectionSnapshot | null,
  ): RackClipboard | null {
    const selection = this.resolveActionSelection(selectionOverride);
    if (!selection) {
      return null;
    }

    const nextClipboard = buildClipboardFromSelection(this.state.chainState, selection);
    if (!nextClipboard) {
      return null;
    }

    this.setClipboard(nextClipboard);
    return nextClipboard;
  }

  private cutSelection(selectionOverride?: RackSelectionSnapshot | null): boolean {
    const selection = this.resolveActionSelection(selectionOverride);
    if (!selection) {
      return false;
    }

    const copied = this.copySelectionToClipboard(selection);
    if (!copied) {
      return false;
    }

    return selection.kind === 'group'
      ? this.deleteGroup(selection.groupId, EDITOR_HISTORY_META.clipboardCut)
      : this.deleteDevicesById(selection.deviceIds, EDITOR_HISTORY_META.clipboardCut);
  }

  private pasteClipboard(
    clipboardOverride?: RackClipboard | null,
    selectionOverride?: RackSelectionSnapshot | null,
    meta: ChainMutationMeta = EDITOR_HISTORY_META.clipboardPaste,
  ): boolean {
    const clipboard = clipboardOverride ?? this.rackClipboard;
    if (!clipboard) {
      return false;
    }

    const selection = this.resolveActionSelection(selectionOverride);
    const nextChain = buildChainWithClipboardPaste(
      this.state.chainState,
      clipboard,
      selection,
    );
    this.applyChainMutation(nextChain, meta);
    return true;
  }

  private duplicateSelection(selectionOverride?: RackSelectionSnapshot | null): boolean {
    const selection = this.resolveActionSelection(selectionOverride);
    if (!selection) {
      return false;
    }

    const copied = this.copySelectionToClipboard(selection);
    if (!copied) {
      return false;
    }

    return this.pasteClipboard(copied, selection, EDITOR_HISTORY_META.duplicate);
  }

  private deleteCurrentSelection(): boolean {
    const rackBinding = this.rackBinding;
    if (!rackBinding) {
      return false;
    }

    const targetIds = resolveDeleteSelectionDeviceIds(
      this.state.chainState,
      rackBinding.getSelectedGroupContexts(),
      rackBinding.getOrderedSelectedDeviceIds(),
    );
    if (targetIds.length === 0) {
      return false;
    }

    return this.deleteDevicesById(targetIds);
  }

  private groupCurrentSelection(): boolean {
    const rackBinding = this.rackBinding;
    if (!rackBinding) {
      return false;
    }

    const selectedGroups = rackBinding.getSelectedGroupContexts();
    if (selectedGroups.length > 0) {
      return false;
    }

    return this.groupDeviceIds(rackBinding.getOrderedSelectedDeviceIds());
  }

  private groupDeviceIds(targetIds: readonly string[]): boolean {
    if (!canCreateGroupFromSelection(this.state.chainState.devices, targetIds)) {
      return false;
    }

    return this.setGroupIdForDevices(
      targetIds,
      resolveNextGroupId(this.state.chainState.devices),
      EDITOR_HISTORY_META.groupCreate,
    );
  }

  private ungroupSelectedGroups(): boolean {
    const rackBinding = this.rackBinding;
    if (!rackBinding) {
      return false;
    }

    let didChange = false;
    for (const selectedGroup of rackBinding.getSelectedGroupContexts()) {
      if (this.ungroupGroup(selectedGroup.groupId, EDITOR_HISTORY_META.groupUngroup)) {
        didChange = true;
      }
    }
    return didChange;
  }
}

export const createEditorSession = (
  options?: EditorSessionOptions,
): EditorSession => new EditorSession(options);
