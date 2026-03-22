import type { BridgeSettings } from '../../shared/bridge/types';
import type { CompassApi } from '../../shared/contracts/ipc/api';
import type { GeneratorPreview } from '../../shared/contracts/preview/generator-preview';
import { clamp } from '../../shared/math';
import {
  cloneChainForIpc,
  type GeneratorChain,
  type LaunchpadModel,
} from '../../shared/model';
import type { EditorSession } from '../features/editor/session.svelte';
import type { PreviewSession } from '../features/preview/session.svelte';
import {
  createPlaybackScheduler,
  createPreviewWindowStatePusher,
} from './playback-runtime';
import { sanitizePreviewBpm } from '../features/editor/persistence-storage';
import type { HeaderIndicatorController } from './header-indicator.svelte';

interface PlaybackSessionState {
  currentBeat: number;
  isPlaying: boolean;
}

interface ApplyPreviewResultInput {
  preview: GeneratorPreview;
  bridge: BridgeSettings | null;
  source: 'preview' | 'send';
  sourceChain: GeneratorChain;
  sourceKey: string;
  launchpadModel: LaunchpadModel;
}

interface PlaybackSessionOptions {
  bridgeClient: CompassApi;
  editorSession: EditorSession;
  previewSession: PreviewSession;
  headerIndicator: HeaderIndicatorController;
  resolveLedRgb: (velocity: number) => string;
  previewWindowStateMaxFps?: number;
  scrubMax?: number;
}

const DEFAULT_PREVIEW_WINDOW_STATE_MAX_FPS = 120;
const DEFAULT_SCRUB_MAX = 1000;

export class PlaybackSessionController {
  public readonly state: PlaybackSessionState = $state({
    currentBeat: 0,
    isPlaying: false,
  });

  private readonly previewWindowStatePusher: ReturnType<typeof createPreviewWindowStatePusher>;

  private playbackScheduler: ReturnType<typeof createPlaybackScheduler> | null = null;

  public constructor(private readonly options: PlaybackSessionOptions) {
    const maxFps = options.previewWindowStateMaxFps ?? DEFAULT_PREVIEW_WINDOW_STATE_MAX_FPS;
    this.previewWindowStatePusher = createPreviewWindowStatePusher({
      bridgeClient: options.bridgeClient,
      minIntervalMs: Math.round(1000 / maxFps),
    });
  }

  public initialize(): void {
    if (this.playbackScheduler) {
      return;
    }

    this.playbackScheduler = createPlaybackScheduler({
      getLoopMs: () => this.getPreviewLoopMs(),
      getLoopEndBeat: () => this.options.previewSession.state.sourceTimelineEndBeat,
      isLoopEnabled: () => this.options.editorSession.state.isPreviewLoopEnabled,
      onFrame: (nextBeat) => {
        this.state.currentBeat = nextBeat;
        this.renderPreviewFrame();
      },
      onPlayStateChange: (nextIsPlaying) => {
        this.state.isPlaying = nextIsPlaying;
      },
    });
  }

  public dispose(): void {
    this.playbackScheduler?.teardown();
    this.playbackScheduler = null;
    this.previewWindowStatePusher.reset();
  }

  public renderPreviewFrame(): void {
    const { editorSession, previewSession, resolveLedRgb } = this.options;
    const uiState = editorSession.state;
    const nextPreviewWindowState = previewSession.commands.renderFrame({
      fallbackChain: uiState.chainState,
      fallbackKey: `chain:${uiState.chainRevision}`,
      launchpadModel: uiState.launchpadModel,
      currentBeat: this.state.currentBeat,
      loopLengthBeats: uiState.previewLoopLengthBeats,
      bpm: uiState.previewBpm,
      isPlaying: this.state.isPlaying,
      isLoopEnabled: uiState.isPreviewLoopEnabled,
      isGuideEnabled: uiState.isPreviewGuideEnabled,
      resolveLedRgb,
    });

    const progress = nextPreviewWindowState.currentBeat / nextPreviewWindowState.sourceTimelineEndBeat;
    const nextPreviewScrubValue = Math.round(
      clamp(progress, 0, 1) * (this.options.scrubMax ?? DEFAULT_SCRUB_MAX),
    );
    if (uiState.previewScrubValue !== nextPreviewScrubValue) {
      uiState.previewScrubValue = nextPreviewScrubValue;
    }

    this.previewWindowStatePusher.push(nextPreviewWindowState);
  }

  public async runPreview(): Promise<void> {
    try {
      const { editorSession, previewSession } = this.options;
      const uiState = editorSession.state;
      const sourceKey = `chain:${uiState.chainRevision}`;
      const launchpadModel = uiState.launchpadModel;
      const sourceChain = cloneChainForIpc(uiState.chainState);
      const preview = previewSession.commands.generateRendererPreview({
        sourceChain,
        sourceKey,
        loopLengthBeats: uiState.previewLoopLengthBeats,
        launchpadModel,
      });

      this.applyPreviewResult({
        preview,
        bridge: null,
        source: 'preview',
        sourceChain,
        sourceKey,
        launchpadModel,
      });
    } catch (error) {
      this.stopPlayback();
      const errorText = error instanceof Error ? error.message : 'Unknown preview error';
      this.options.headerIndicator.show(`Preview update failed | ${errorText}`);
    }
  }

  public applyPreviewResult(input: ApplyPreviewResultInput): void {
    const { editorSession, previewSession } = this.options;
    const nextLoopLengthBeats =
      input.bridge?.autoCreateLengthBeats
      ?? editorSession.readBridgeSettings().autoCreateLengthBeats;

    previewSession.commands.applyPreviewResult({
      preview: input.preview,
      sourceChain: input.sourceChain,
      sourceKey: input.sourceKey,
      loopLengthBeats: nextLoopLengthBeats,
      launchpadModel: input.launchpadModel,
    });
    editorSession.state.previewLoopLengthBeats = nextLoopLengthBeats;

    if (this.playbackScheduler) {
      this.playbackScheduler.setCurrentBeat(0);
    } else {
      this.state.currentBeat = 0;
      this.renderPreviewFrame();
    }

    if (input.preview.noteCount > 0) {
      if (input.source === 'preview') {
        this.options.headerIndicator.show(`${input.preview.noteCount} notes generated`);
      } else {
        this.options.headerIndicator.show('Send complete');
      }
      this.startPlayback();
      return;
    }

    this.options.headerIndicator.clear();
    this.stopPlayback();
  }

  public startPlayback(): void {
    if (this.options.previewSession.state.noteCount === 0) {
      return;
    }

    if (!this.playbackScheduler || this.playbackScheduler.isPlaying()) {
      return;
    }

    this.playbackScheduler.start();
  }

  public stopPlayback(): void {
    this.playbackScheduler?.stop();
  }

  public togglePlayback(): void {
    if (this.state.isPlaying) {
      this.stopPlayback();
      return;
    }

    this.startPlayback();
  }

  public togglePreviewLoop(): void {
    if (this.options.editorSession.commands.togglePreviewLoopEnabled()) {
      this.renderPreviewFrame();
    }
  }

  public setPreviewGuideEnabled(nextEnabled: boolean): void {
    if (this.options.editorSession.commands.setPreviewGuideEnabled(nextEnabled)) {
      this.renderPreviewFrame();
    }
  }

  public async openPreviewPopout(): Promise<void> {
    try {
      await this.options.bridgeClient.openPreviewWindow();
      this.options.editorSession.state.isPreviewPopoutOpen = true;
      this.renderPreviewFrame();
    } catch {
      this.options.headerIndicator.show('Failed to open preview popout');
    }
  }

  public scrubPreview(scrubValue: number): void {
    const scrubProgress = clamp(
      Number(scrubValue) / (this.options.scrubMax ?? DEFAULT_SCRUB_MAX),
      0,
      1,
    );
    const nextBeat = scrubProgress * this.options.previewSession.state.sourceTimelineEndBeat;
    if (this.playbackScheduler) {
      this.playbackScheduler.setCurrentBeat(nextBeat);
      return;
    }

    this.state.currentBeat = nextBeat;
    this.renderPreviewFrame();
  }

  public syncPreviewBpm(nextBpm: number): void {
    if (this.options.editorSession.commands.syncPreviewBpm(nextBpm)) {
      this.options.headerIndicator.show('BPM synced');
    }
  }

  public setPreviewPopoutOpen(nextEnabled: boolean): void {
    this.options.editorSession.state.isPreviewPopoutOpen = nextEnabled;
  }

  public async requestLiveTempoSync(): Promise<void> {
    await this.options.bridgeClient.requestLiveTempo();
  }

  private getPreviewLoopMs(): number {
    const bpm = sanitizePreviewBpm(this.options.editorSession.state.previewBpm);
    const beats = Math.max(this.options.editorSession.state.previewLoopLengthBeats, 0.25);
    return (60000 / bpm) * beats;
  }
}

export const createPlaybackSession = (
  options: PlaybackSessionOptions,
): PlaybackSessionController => new PlaybackSessionController(options);
