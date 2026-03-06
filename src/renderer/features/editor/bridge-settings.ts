import {
  AUTO_CREATE_LENGTH_OPTIONS,
  parseBeatsValue,
  toLengthPresetLabel,
} from '../../../shared/beat-length';
import type { BridgeSettings } from '../../../shared/bridge/types';
import type { LaunchpadModel } from '../../../shared/model';
import { sanitizeBridgeSettings } from '../../../shared/validation/bridge-settings';
import {
  sanitizePreviewBpm,
  saveBridgeSettings,
  saveLaunchpadModel,
  savePreviewBpm,
  savePreviewGuideEnabled,
  savePreviewLoopEnabled,
} from './persistence-storage';
import type { EditorSessionState } from './session.svelte';

export const readBridgeSettingsFromLabel = (lengthLabel: string): BridgeSettings =>
  sanitizeBridgeSettings({
    autoCreateLengthBeats: parseBeatsValue(lengthLabel),
  });

export const resolveBridgeLengthLabel = (bridge: BridgeSettings): string =>
  toLengthPresetLabel(bridge.autoCreateLengthBeats, AUTO_CREATE_LENGTH_OPTIONS[0].label);

export const handleAutoCreateLengthChange = (
  state: EditorSessionState,
  scheduleAutoPreview: (delayMs?: number) => void,
): void => {
  const bridge = readBridgeSettingsFromLabel(state.autoCreateLengthLabel);
  state.previewLoopLengthBeats = bridge.autoCreateLengthBeats;
  saveBridgeSettings(bridge);
  scheduleAutoPreview(0);
};

export const setLaunchpadModelEnabled = (
  state: EditorSessionState,
  nextEnabled: boolean,
  scheduleAutoPreview: (delayMs?: number) => void,
): boolean => {
  const nextModel: LaunchpadModel = nextEnabled ? 'mk2' : 'mk3';
  if (state.launchpadModel === nextModel) {
    return false;
  }

  state.launchpadModel = nextModel;
  saveLaunchpadModel(nextModel);
  scheduleAutoPreview(0);
  return true;
};

export const togglePreviewLoopEnabled = (
  state: EditorSessionState,
): boolean => {
  state.isPreviewLoopEnabled = !state.isPreviewLoopEnabled;
  savePreviewLoopEnabled(state.isPreviewLoopEnabled);
  return true;
};

export const setPreviewGuideEnabled = (
  state: EditorSessionState,
  nextEnabled: boolean,
): boolean => {
  if (state.isPreviewGuideEnabled === nextEnabled) {
    return false;
  }

  state.isPreviewGuideEnabled = nextEnabled;
  savePreviewGuideEnabled(nextEnabled);
  return true;
};

export const syncPreviewBpm = (
  state: EditorSessionState,
  nextBpm: number,
): boolean => {
  const sanitized = sanitizePreviewBpm(nextBpm);
  if (Math.abs(sanitized - state.previewBpm) < 0.0001) {
    return false;
  }

  state.previewBpm = sanitized;
  savePreviewBpm(sanitized);
  return true;
};

export const applyBridgeSettings = (
  state: EditorSessionState,
  bridge: BridgeSettings,
  options: {
    persist?: boolean;
  } = {},
): void => {
  state.autoCreateLengthLabel = resolveBridgeLengthLabel(bridge);
  state.previewLoopLengthBeats = bridge.autoCreateLengthBeats;
  if (options.persist === true) {
    saveBridgeSettings(bridge);
  }
};
