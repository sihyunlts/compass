import {
  loadBridgeSettings,
  loadChainSettings,
  loadCollapsedDeviceIds,
  loadLaunchpadModel,
  loadPreviewBpm,
  loadPreviewGuideEnabled,
  loadPreviewLoopEnabled,
  loadSidebarWidth,
  saveChainSettings,
  saveCollapsedDeviceIds,
  saveSidebarWidth,
} from './persistence-storage';
import {
  resolveBridgeLengthLabel,
} from './bridge-settings';
import type { EditorSessionState } from './session.svelte';

export const createInitialEditorState = (): EditorSessionState => {
  const bridge = loadBridgeSettings();
  const loadedChain = loadChainSettings();
  return {
    chainState: loadedChain.chain,
    chainRevision: 1,
    launchpadModel: loadLaunchpadModel(),
    headerIndicatorText: loadedChain.warning ?? '',
    paletteNameText: 'Default palette: loading...',
    isSettingsOpen: false,
    previewBpm: loadPreviewBpm(),
    previewLoopLengthBeats: bridge.autoCreateLengthBeats,
    isPreviewLoopEnabled: loadPreviewLoopEnabled(),
    isPreviewGuideEnabled: loadPreviewGuideEnabled(),
    isPreviewPopoutOpen: false,
    previewScrubValue: 0,
    autoCreateLengthLabel: resolveBridgeLengthLabel(bridge),
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

export const persistSidebarWidth = (
  state: EditorSessionState,
  nextWidth?: number,
): void => {
  saveSidebarWidth(nextWidth ?? state.sidebarWidthPx);
};

export const toggleCollapse = (
  state: EditorSessionState,
  id: string,
): void => {
  const next = state.collapsedDeviceIds.includes(id)
    ? state.collapsedDeviceIds.filter((item) => item !== id)
    : [...state.collapsedDeviceIds, id];
  state.collapsedDeviceIds = next;
  saveCollapsedDeviceIds(next);
};

const pruneCollapsedDeviceIds = (state: EditorSessionState): void => {
  const validIds = state.chainState.devices.map((device) => device.id);
  const next = state.collapsedDeviceIds.filter((id) => validIds.includes(id));
  if (next.length === state.collapsedDeviceIds.length) {
    return;
  }

  state.collapsedDeviceIds = next;
  saveCollapsedDeviceIds(next);
};

export const persistChainState = (
  state: EditorSessionState,
  requestSyncAfterRender: () => void,
): void => {
  pruneCollapsedDeviceIds(state);
  saveChainSettings(state.chainState);
  requestSyncAfterRender();
};
