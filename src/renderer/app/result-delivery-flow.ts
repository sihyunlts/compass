import { cloneChainForIpc } from '../../shared/model';
import type { CompassApi } from '../../shared/contracts/ipc/api';
import type { EditorSession } from '../features/editor/session.svelte';
import type { HeaderIndicatorController } from './header-indicator.svelte';
import { downloadGeneratedPreviewMidi } from './midi-download';
import {
  createPreviewSourceKey,
  type PlaybackSessionController,
} from './playback-session.svelte';
import { i18n } from '../i18n.svelte';

type ResultDeliveryMode = 'ableton' | 'midi-download';

interface ResultDeliveryFlowOptions {
  bridgeClient: CompassApi;
  editorSession: EditorSession;
  headerIndicator: HeaderIndicatorController;
  playbackSession: PlaybackSessionController;
  mode: ResultDeliveryMode;
  doneDisplayMs?: number;
}

const DEFAULT_DONE_DISPLAY_MS = 900;
const MESSAGE_KEYS_BY_MODE = {
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

class ResultDeliveryFlowController {
  private doneTimer: number | null = null;

  public constructor(private readonly options: ResultDeliveryFlowOptions) {}

  public async deliver(clipName: string): Promise<void> {
    const {
      bridgeClient,
      editorSession,
      headerIndicator,
      mode,
      playbackSession,
    } = this.options;
    const uiState = editorSession.state;
    const isMidiDownload = mode === 'midi-download';
    const messageKeys = MESSAGE_KEYS_BY_MODE[mode];

    editorSession.cancelAutoPreview();
    this.clearDoneTimer();
    uiState.deliveryButtonState = 'working';
    headerIndicator.show(i18n.t(messageKeys.working), { autoClear: false });
    playbackSession.prepareForDelivery();

    try {
      const bridge = editorSession.readBridgeSettings();
      editorSession.applyBridgeSettings(bridge, { persist: true });
      const launchpadModel = uiState.launchpadModel;
      const sourceChain = cloneChainForIpc(uiState.chainState);
      const sourceKey = createPreviewSourceKey(uiState.previewSourceRevision, sourceChain);
      const preview = await playbackSession.generatePreviewForDelivery({
        sourceChain,
        sourceKey,
        loopLengthBeats: bridge.autoCreateLengthBeats,
        launchpadModel,
      });

      playbackSession.applyPreviewResult({
        preview,
        bridge,
        source: 'delivery',
        sourceChain,
        sourceKey,
        launchpadModel,
        announce: false,
      });

      if (isMidiDownload) {
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
    } catch (error) {
      playbackSession.stopPlayback();
      const errorText = error instanceof Error
        ? error.message
        : i18n.t(messageKeys.unknownError);
      headerIndicator.show(
        i18n.t(messageKeys.failed, { error: errorText }),
      );
      uiState.deliveryButtonState = 'idle';
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
