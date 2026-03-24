import {
  loadBridgeSettings,
  loadChainSettings,
  loadCollapsedDeviceIds,
  loadLaunchpadModel,
  loadPreviewBpm,
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
    sidebarPage: 'devices',
    chainState: loadedChain.chain,
    chainRevision: 1,
    launchpadModel: loadLaunchpadModel(),
    headerIndicatorText: loadedChain.warning ?? '',
    paletteNameText: 'Default palette: loading...',
    previewBpm: loadPreviewBpm(),
    previewLoopLengthBeats: bridge.autoCreateLengthBeats,
    isPreviewLoopEnabled: loadPreviewLoopEnabled(),
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

const filterCollapsedDeviceIds = (
  state: EditorSessionState,
  ids: readonly string[],
): string[] => {
  const validIds = new Set(state.chainState.devices.map((device) => device.id));
  return ids.filter((id) => validIds.has(id));
};

export const replaceCollapsedDeviceIds = (
  state: EditorSessionState,
  ids: readonly string[],
): void => {
  const next = filterCollapsedDeviceIds(state, ids);
  state.collapsedDeviceIds = next;
  saveCollapsedDeviceIds(next);
};

export const mergeCollapsedDeviceIds = (
  state: EditorSessionState,
  ids: readonly string[],
): void => {
  const next = filterCollapsedDeviceIds(state, [
    ...state.collapsedDeviceIds,
    ...ids,
  ]);
  state.collapsedDeviceIds = [...new Set(next)];
  saveCollapsedDeviceIds(state.collapsedDeviceIds);
};

const pruneCollapsedDeviceIds = (state: EditorSessionState): void => {
  const next = filterCollapsedDeviceIds(state, state.collapsedDeviceIds);
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
