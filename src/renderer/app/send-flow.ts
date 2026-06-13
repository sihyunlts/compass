import { cloneChainForIpc } from '../../shared/model';
import type { CompassApi } from '../../shared/contracts/ipc/api';
import type { EditorSession } from '../features/editor/session.svelte';
import type { HeaderIndicatorController } from './header-indicator.svelte';
import {
  createPreviewSourceKey,
  type PlaybackSessionController,
} from './playback-session.svelte';

interface SendFlowOptions {
  bridgeClient: CompassApi;
  editorSession: EditorSession;
  headerIndicator: HeaderIndicatorController;
  playbackSession: PlaybackSessionController;
  sendDoneMs?: number;
}

const DEFAULT_SEND_DONE_MS = 900;

class SendFlowController {
  private sendDoneTimer: number | null = null;

  public constructor(private readonly options: SendFlowOptions) {}

  public async send(): Promise<void> {
    const { bridgeClient, editorSession, headerIndicator, playbackSession } = this.options;
    const uiState = editorSession.state;

    editorSession.cancelAutoPreview();
    this.clearSendDoneTimer();
    uiState.sendButtonLabel = 'Sending...';
    uiState.sendButtonDisabled = true;
    headerIndicator.show('Sending...', { autoClear: false });

    try {
      const bridge = editorSession.readBridgeSettings();
      editorSession.applyBridgeSettings(bridge, { persist: true });
      const launchpadModel = uiState.launchpadModel;
      const sourceChain = cloneChainForIpc(uiState.chainState);
      const sourceKey = createPreviewSourceKey(uiState.chainRevision, sourceChain);
      const preview = await playbackSession.generatePreviewForSend({
        sourceChain,
        sourceKey,
        loopLengthBeats: bridge.autoCreateLengthBeats,
        launchpadModel,
      });

      playbackSession.applyPreviewResult({
        preview,
        bridge,
        source: 'send',
        sourceChain,
        sourceKey,
        launchpadModel,
        announce: false,
      });

      await bridgeClient.sendGeneratedPreview({
        preview,
        bridge,
      });

      if (preview.noteCount > 0) {
        headerIndicator.show('Send complete');
      } else {
        headerIndicator.clear();
      }

      uiState.sendButtonLabel = 'Done!';
      uiState.sendButtonDisabled = false;
      this.sendDoneTimer = window.setTimeout(() => {
        this.sendDoneTimer = null;
        uiState.sendButtonLabel = 'Send';
        uiState.sendButtonDisabled = false;
      }, this.options.sendDoneMs ?? DEFAULT_SEND_DONE_MS);
    } catch (error) {
      playbackSession.stopPlayback();
      const errorText = error instanceof Error ? error.message : 'Unknown send error';
      headerIndicator.show(`Send failed | ${errorText}`);
      uiState.sendButtonLabel = 'Send';
      uiState.sendButtonDisabled = false;
    }
  }

  public dispose(): void {
    this.clearSendDoneTimer();
  }

  private clearSendDoneTimer(): void {
    if (this.sendDoneTimer === null) {
      return;
    }

    window.clearTimeout(this.sendDoneTimer);
    this.sendDoneTimer = null;
  }
}

export const createSendFlow = (
  options: SendFlowOptions,
): SendFlowController => new SendFlowController(options);
