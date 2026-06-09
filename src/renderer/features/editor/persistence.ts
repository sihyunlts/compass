import {
  createDefaultChainSettings,
  loadBridgeSettings,
  loadLaunchpadModel,
  loadPreviewBpm,
  loadPreviewLoopEnabled,
  loadSidebarWidth,
  saveSidebarWidth,
} from './persistence-storage';
import {
  resolveBridgeLengthLabel,
} from './bridge-settings';
import type { EditorSessionState } from './session.svelte';

export const createInitialEditorState = (): EditorSessionState => {
  const bridge = loadBridgeSettings();
  return {
    sidebarPage: 'devices',
    chainState: createDefaultChainSettings(),
    chainRevision: 1,
    launchpadModel: loadLaunchpadModel(),
    headerIndicatorText: '',
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
    collapsedDeviceIds: [],
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
};

const pruneCollapsedDeviceIds = (state: EditorSessionState): void => {
  const next = filterCollapsedDeviceIds(state, state.collapsedDeviceIds);
  if (next.length === state.collapsedDeviceIds.length) {
    return;
  }

  state.collapsedDeviceIds = next;
};

export const persistChainState = (
  state: EditorSessionState,
  requestSyncAfterRender: () => void,
): void => {
  pruneCollapsedDeviceIds(state);
  requestSyncAfterRender();
};
