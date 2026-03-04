import { toLengthPresetLabel } from '../../shared/beat-length';
import type { GeneratorChain, LaunchpadModel } from '../../shared/types';
import {
  loadBridgeSettings,
  loadChainSettings,
  loadLaunchpadModel,
  loadPreviewBpm,
  loadPreviewGuideEnabled,
  loadPreviewLoopEnabled,
  loadSidebarWidth,
} from '../services/storage';

/** Main renderer app state for the primary window. */
export interface AppState {
  chainState: GeneratorChain;
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
}

/** Builds initial renderer state from persisted settings plus derived UI labels. */
export const createInitialAppState = (): AppState => {
  const bridge = loadBridgeSettings();
  return {
    chainState: loadChainSettings(),
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
    autoCreateLengthLabel: toLengthPresetLabel(bridge.autoCreateLengthBeats),
    previewPlayLabel: 'Play',
    sendButtonLabel: 'Send',
    sendButtonDisabled: false,
    sidebarWidthPx: loadSidebarWidth(),
    isSidebarResizing: false,
  };
};
