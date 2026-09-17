import { cloneChainForIpc } from '../../shared/model';
import type { CompassApi } from '../../shared/contracts/ipc/api';
import type { EditorSession } from '../features/editor/session.svelte';
import type { HeaderIndicatorController } from './header-indicator.svelte';
import { downloadGeneratedPreviewMidi } from './midi-download';
import type { PlaybackSessionController } from './playback-session.svelte';
import { createPreviewSourceKey } from '../features/preview/generation-session.svelte';
import { i18n } from '../i18n.svelte';

type ResultDeliveryMode = 'ableton' | 'midi-download';

interface ResultDeliveryFlowOptions {
  bridgeClient: CompassApi;
  editorSession: EditorSession;
  headerIndicator: HeaderIndicatorController;
  playbackSession: PlaybackSessionController;
  primaryMode: ResultDeliveryMode;
  doneDisplayMs?: number;
}

const DEFAULT_DONE_DISPLAY_MS = 900;
const DELIVERY_MESSAGE_KEYS_BY_MODE = {
  ableton: {
    working: 'status.sending',
    complete: 'status.sendComplete',
    failed: 'status.sendFailed',
    unknownError: 'status.unknownSendError',
  },
  'midi-download': {
    working: 'status.downloading',
    complete: 'status.downloadComplete',
    failed: 'status.downloadFailed',
    unknownError: 'status.unknownDownloadError',
  },
} as const;
const MIDI_SAVE_ERROR_MESSAGE_KEYS = {
  failed: 'status.midiSaveFailed',
  unknownError: 'status.unknownMidiSaveError',
} as const;

class ResultDeliveryFlowController {
  private doneTimer: number | null = null;

  public constructor(private readonly options: ResultDeliveryFlowOptions) {}

  public deliver(clipName: string): Promise<void> {
    return this.runDelivery(clipName, this.options.primaryMode, true);
  }

  public saveMidi(clipName: string): Promise<void> {
    return this.runDelivery(clipName, 'midi-download', false);
  }

  private async runDelivery(
    clipName: string,
    mode: ResultDeliveryMode,
    showDeliveryFeedback: boolean,
  ): Promise<void> {
    if (this.options.editorSession.state.isDelivering) {
      return;
    }

    const {
      bridgeClient,
      editorSession,
      headerIndicator,
      playbackSession,
    } = this.options;
    const uiState = editorSession.state;
    const messageKeys = DELIVERY_MESSAGE_KEYS_BY_MODE[mode];
    uiState.isDelivering = true;
    this.clearDoneTimer();
    uiState.deliveryButtonState = showDeliveryFeedback ? 'working' : 'idle';

    try {
      editorSession.cancelAutoPreview();
      if (showDeliveryFeedback) {
        headerIndicator.show(i18n.t(messageKeys.working), { autoClear: false });
      }
      playbackSession.prepareForDelivery();
      const bridge = editorSession.readBridgeSettings();
      editorSession.applyBridgeSettings(bridge, { persist: true });
      const launchpadModel = uiState.launchpadModel;
      const sourceChain = cloneChainForIpc(uiState.chainState);
      const sourceKey = createPreviewSourceKey(uiState.previewSourceRevision, sourceChain);
      const preview = await playbackSession.resolvePreviewForDelivery({
        sourceChain,
        sourceKey,
        loopLengthBeats: bridge.autoCreateLengthBeats,
        launchpadModel,
      });

      playbackSession.applyPreviewResult({
        preview,
        bridge,
        reason: 'delivery',
        sourceChain,
        sourceKey,
        launchpadModel,
        announce: false,
      });

      if (mode === 'midi-download') {
        downloadGeneratedPreviewMidi({
          preview,
          clipName,
        });
      } else {
        await bridgeClient.sendGeneratedPreview({
          preview,
          bridge,
          clipName,
        });
      }

      if (showDeliveryFeedback) {
        if (preview.noteCount > 0) {
          headerIndicator.show(i18n.t(messageKeys.complete));
        } else {
          headerIndicator.clear();
        }
        uiState.deliveryButtonState = 'done';
        this.doneTimer = window.setTimeout(() => {
          this.doneTimer = null;
          uiState.deliveryButtonState = 'idle';
        }, this.options.doneDisplayMs ?? DEFAULT_DONE_DISPLAY_MS);
      }
    } catch (error) {
      playbackSession.stopPlayback();
      const errorMessageKeys = showDeliveryFeedback ? messageKeys : MIDI_SAVE_ERROR_MESSAGE_KEYS;
      const errorText = error instanceof Error
        ? error.message
        : i18n.t(errorMessageKeys.unknownError);
      headerIndicator.show(
        i18n.t(errorMessageKeys.failed, { error: errorText }),
      );
      uiState.deliveryButtonState = 'idle';
    } finally {
      uiState.isDelivering = false;
    }
  }

  public dispose(): void {
    this.clearDoneTimer();
  }

  private clearDoneTimer(): void {
    if (this.doneTimer === null) {
      return;
    }

    window.clearTimeout(this.doneTimer);
    this.doneTimer = null;
  }
}

export const createResultDeliveryFlow = (
  options: ResultDeliveryFlowOptions,
): ResultDeliveryFlowController => new ResultDeliveryFlowController(options);
