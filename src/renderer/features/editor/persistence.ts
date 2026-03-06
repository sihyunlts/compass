import { reconcileGeneratorChainModulators } from '../../../core/modulation/routing';
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
} from '../../services/storage';
import { withDevices } from './chain-ops';
import {
  resolveBridgeLengthLabel,
} from './bridge-settings';
import type { EditorSessionState } from './session.svelte';

export const createInitialEditorState = (): EditorSessionState => {
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

export const reconcileCurrentChainModulators = (
  state: EditorSessionState,
): boolean => {
  const changed = reconcileGeneratorChainModulators(state.chainState);
  if (!changed) {
    return false;
  }

  state.chainState = withDevices(
    state.chainState,
    [...state.chainState.devices],
  );
  return true;
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
  reconcileCurrentChainModulators(state);
  pruneCollapsedDeviceIds(state);
  saveChainSettings(state.chainState);
  requestSyncAfterRender();
};
