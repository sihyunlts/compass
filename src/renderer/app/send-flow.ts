import { cloneChainForIpc } from '../../shared/model';
import type { CompassApi } from '../../shared/contracts/ipc/api';
import type { EditorSession } from '../features/editor/session.svelte';
import type { HeaderIndicatorController } from './header-indicator.svelte';
import type { PlaybackSessionController } from './playback-session.svelte';

interface SendFlowOptions {
  bridgeClient: CompassApi;
  editorSession: EditorSession;
  headerIndicator: HeaderIndicatorController;
  playbackSession: PlaybackSessionController;
  sendDoneMs?: number;
}

const DEFAULT_SEND_DONE_MS = 900;

export class SendFlowController {
  private sendDoneTimer: number | null = null;

  public constructor(private readonly options: SendFlowOptions) {}

  public async send(): Promise<void> {
    const { bridgeClient, editorSession, headerIndicator, playbackSession } = this.options;
    const uiState = editorSession.state;

    editorSession.commands.cancelAutoPreview();
    this.clearSendDoneTimer();
    editorSession.commands.setSendButtonState('Sending...', true);
    headerIndicator.show('Sending...', { autoClear: false });

    try {
      const bridge = editorSession.commands.readBridgeSettings();
      editorSession.commands.applyBridgeSettings(bridge, { persist: true });
      const sourceKey = `chain:${uiState.chainRevision}`;
      const launchpadModel = uiState.launchpadModel;
      const sourceChain = cloneChainForIpc(uiState.chainState);

      const response = await bridgeClient.generateAndSend({
        chain: sourceChain,
        bridge,
        launchpadModel,
      });

      playbackSession.applyPreviewResult({
        preview: response.preview,
        bridge: response.bridge,
        source: 'send',
        sourceChain,
        sourceKey,
        launchpadModel,
      });

      editorSession.commands.setSendButtonState('Done!', false);
      this.sendDoneTimer = window.setTimeout(() => {
        this.sendDoneTimer = null;
        editorSession.commands.setSendButtonState('Send', false);
      }, this.options.sendDoneMs ?? DEFAULT_SEND_DONE_MS);
    } catch (error) {
      playbackSession.stopPlayback();
      const errorText = error instanceof Error ? error.message : 'Unknown send error';
      headerIndicator.show(`Send failed | ${errorText}`);
      editorSession.commands.setSendButtonState('Send', false);
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
