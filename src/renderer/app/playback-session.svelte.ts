import type { BridgeSettings } from '../../shared/bridge/types';
import type { CompassApi } from '../../shared/contracts/ipc/api';
import type { GeneratorPreview } from '../../shared/contracts/preview/generator-preview';
import {
  PREVIEW_SCRUB_MAX,
  type PreviewWindowState,
} from '../../shared/contracts/preview/window-state';
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
import { createPreviewGenerationWorkerClient } from '../features/preview/generation-worker-client';
import type { HeaderIndicatorController } from './header-indicator.svelte';

interface PlaybackSessionState {
  currentBeat: number;
  isPlaying: boolean;
  isPreviewGenerating: boolean;
}

interface ApplyPreviewResultInput {
  preview: GeneratorPreview;
  bridge: BridgeSettings | null;
  source: 'preview' | 'send';
  sourceChain: GeneratorChain;
  sourceKey: string;
  launchpadModel: LaunchpadModel;
  announce?: boolean;
}

interface PlaybackSessionOptions {
  bridgeClient: CompassApi;
  editorSession: EditorSession;
  previewSession: PreviewSession;
  headerIndicator: HeaderIndicatorController;
  resolveLedRgb: (velocity: number) => string;
  resolvePreviewVisual?: (input: {
    rackActiveCells: PreviewWindowState['activeCells'];
    elapsedMs: number;
    launchpadModel: LaunchpadModel;
  }) => {
    activeCells: PreviewWindowState['activeCells'];
    progress01: number;
  } | null;
  onPreviewVisualStart?: () => void;
  previewWindowStateMaxFps?: number;
  scrubMax?: number;
}

interface PreviewGenerationSource {
  sourceChain: GeneratorChain;
  sourceKey: string;
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
}

interface CachedGeneratedPreview {
  sourceKey: string;
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
  preview: GeneratorPreview;
}

type PreviewVisualPhase =
  | 'disabled'
  | 'armed'
  | 'waiting'
  | 'active'
  | 'consumed';

const DEFAULT_PREVIEW_WINDOW_STATE_MAX_FPS = 120;

const hashPreviewSource = (chain: GeneratorChain): string => {
  const source = JSON.stringify(chain);
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${(hash >>> 0).toString(16)}-${source.length}`;
};

export const createPreviewSourceKey = (
  chainRevision: number,
  chain: GeneratorChain,
): string =>
  `chain:${chainRevision}:${hashPreviewSource(chain)}`;

export class PlaybackSessionController {
  public readonly state: PlaybackSessionState = $state({
    currentBeat: 0,
    isPlaying: false,
    isPreviewGenerating: false,
  });

  private readonly previewWindowStatePusher: ReturnType<typeof createPreviewWindowStatePusher>;

  private playbackScheduler: ReturnType<typeof createPlaybackScheduler> | null = null;

  private readonly previewGenerator = createPreviewGenerationWorkerClient();

  private previewGenerationRequestId = 0;

  private previewGenerationPurpose: 'preview' | 'send' | null = null;

  private latestGeneratedPreview: CachedGeneratedPreview | null = null;

  private previewVisualStartedAtMs: number | null = null;

  private previewVisualPhase: PreviewVisualPhase = 'disabled';

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
      isLoopEnabled: () =>
        this.options.editorSession.state.isPreviewLoopEnabled
        || this.isPreviewVisualKeepingPlaybackAlive(),
      onFrame: (nextBeat) => {
        this.state.currentBeat = nextBeat;
        this.renderPreviewFrame();
      },
      onPlayStateChange: (nextIsPlaying) => {
        this.state.isPlaying = nextIsPlaying;
        if (nextIsPlaying) {
          if (this.previewVisualPhase === 'armed') {
            this.previewVisualPhase = 'waiting';
            this.previewVisualStartedAtMs = window.performance.now();
          }
          return;
        }
        if (
          this.previewVisualPhase === 'waiting'
          || this.previewVisualPhase === 'active'
        ) {
          this.previewVisualPhase = 'consumed';
        }
        this.previewVisualStartedAtMs = null;
      },
    });
    if (this.previewVisualPhase === 'armed') {
      this.playbackScheduler.start();
    }
  }

  public dispose(): void {
    this.playbackScheduler?.teardown();
    this.playbackScheduler = null;
    this.previewGenerator.dispose();
    this.previewWindowStatePusher.reset();
    this.options.previewSession.commands.resetCaches();
  }

  public renderPreviewFrame(): void {
    const { editorSession, previewSession, resolveLedRgb } = this.options;
    const uiState = editorSession.state;
    let previewVisualProgress01: number | null = null;
    const nextPreviewWindowState = previewSession.commands.renderFrame({
      fallbackChain: uiState.chainState,
      fallbackKey: `chain:${uiState.chainRevision}`,
      launchpadModel: uiState.launchpadModel,
      currentBeat: this.state.currentBeat,
      loopLengthBeats: uiState.previewLoopLengthBeats,
      bpm: uiState.previewBpm,
      isPlaying: this.state.isPlaying,
      isLoopEnabled: uiState.isPreviewLoopEnabled,
      resolveLedRgb,
      resolveActiveCells: (rackActiveCells) => {
        if (
          !this.state.isPlaying
          || (
            this.previewVisualPhase !== 'waiting'
            && this.previewVisualPhase !== 'active'
          )
          || !this.options.resolvePreviewVisual
        ) {
          return rackActiveCells;
        }

        const previewVisual = this.options.resolvePreviewVisual({
          rackActiveCells,
          elapsedMs: this.resolvePreviewVisualElapsedMs(),
          launchpadModel: uiState.launchpadModel,
        });
        if (!previewVisual) {
          if (this.previewVisualPhase === 'active') {
            this.previewVisualPhase = 'consumed';
          }
          return rackActiveCells;
        }
        previewVisualProgress01 = clamp(previewVisual.progress01, 0, 1);
        if (this.previewVisualPhase === 'waiting') {
          this.previewVisualPhase = 'active';
          this.options.onPreviewVisualStart?.();
        }
        return previewVisual.activeCells;
      },
    });
    if (previewVisualProgress01 !== null) {
      nextPreviewWindowState.displayProgress01 = previewVisualProgress01;
    }

    const progress = nextPreviewWindowState.displayProgress01
      ?? nextPreviewWindowState.currentBeat / nextPreviewWindowState.sourceTimelineEndBeat;
    const nextPreviewScrubValue = Math.round(
      clamp(progress, 0, 1) * (this.options.scrubMax ?? PREVIEW_SCRUB_MAX),
    );
    if (uiState.previewScrubValue !== nextPreviewScrubValue) {
      uiState.previewScrubValue = nextPreviewScrubValue;
    }

    this.previewWindowStatePusher.push(nextPreviewWindowState);
  }

  public async runPreview(): Promise<void> {
    if (this.previewGenerationPurpose === 'send') {
      return;
    }

    try {
      const { editorSession } = this.options;
      const uiState = editorSession.state;
      const launchpadModel = uiState.launchpadModel;
      const sourceChain = cloneChainForIpc(uiState.chainState);
      const sourceKey = createPreviewSourceKey(uiState.chainRevision, sourceChain);
      const preview = await this.resolveGeneratedPreview({
        sourceChain,
        sourceKey,
        loopLengthBeats: uiState.previewLoopLengthBeats,
        launchpadModel,
      }, 'preview');

      this.applyPreviewResult({
        preview,
        bridge: null,
        source: 'preview',
        sourceChain,
        sourceKey,
        launchpadModel,
      });
    } catch (error) {
      if (isPreviewGenerationCancelled(error)) {
        return;
      }
      this.stopPlayback();
      const errorText = error instanceof Error ? error.message : 'Unknown preview error';
      this.options.headerIndicator.show(`Preview update failed | ${errorText}`);
    }
  }

  public async generatePreviewForSend(input: PreviewGenerationSource): Promise<GeneratorPreview> {
    return this.resolveGeneratedPreview(input, 'send');
  }

  public applyPreviewResult(input: ApplyPreviewResultInput): void {
    const { editorSession, previewSession } = this.options;
    const shouldAnnounce = input.announce ?? true;
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
    this.latestGeneratedPreview = {
      sourceKey: input.sourceKey,
      loopLengthBeats: nextLoopLengthBeats,
      launchpadModel: input.launchpadModel,
      preview: input.preview,
    };

    if (this.playbackScheduler) {
      this.playbackScheduler.setCurrentBeat(0);
    } else {
      this.state.currentBeat = 0;
      this.renderPreviewFrame();
    }

    if (input.preview.noteCount > 0) {
      if (shouldAnnounce) {
        if (input.source === 'preview') {
          this.options.headerIndicator.show(`${input.preview.noteCount} notes generated`);
        } else {
          this.options.headerIndicator.show('Send complete');
        }
      }
      this.startPlayback();
      return;
    }

    if (shouldAnnounce) {
      this.options.headerIndicator.clear();
    }
    if (this.previewVisualPhase === 'armed') {
      this.playbackScheduler?.start();
      return;
    }
    if (
      this.previewVisualPhase === 'waiting'
      || this.previewVisualPhase === 'active'
    ) {
      return;
    }
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

  public prepareForSend(): void {
    if (this.previewVisualPhase !== 'disabled') {
      this.previewVisualPhase = 'consumed';
    }
    this.stopPlayback();
  }

  public setPreviewVisualEnabled(enabled: boolean): void {
    if (!enabled) {
      this.previewVisualPhase = 'disabled';
      this.previewVisualStartedAtMs = null;
      this.renderPreviewFrame();
      return;
    }

    if (!this.playbackScheduler) {
      this.previewVisualPhase = 'armed';
      this.previewVisualStartedAtMs = null;
    } else if (this.state.isPlaying) {
      this.previewVisualPhase = 'waiting';
      this.previewVisualStartedAtMs = window.performance.now();
    } else {
      this.previewVisualPhase = 'armed';
      this.previewVisualStartedAtMs = null;
      this.playbackScheduler.start();
      return;
    }
    this.renderPreviewFrame();
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

  public async openPreviewPopout(): Promise<void> {
    try {
      await this.options.bridgeClient.openPreviewWindow();
      this.options.editorSession.state.isPreviewPopoutOpen = true;
      this.renderPreviewFrame();
    } catch {
      this.options.headerIndicator.show('Failed to open preview popout');
    }
  }

  public seekPreview(scrubValue: number): void {
    const scrubProgress = clamp(
      Number(scrubValue) / (this.options.scrubMax ?? PREVIEW_SCRUB_MAX),
      0,
      1,
    );
    const nextBeat = scrubProgress * this.options.previewSession.state.sourceTimelineEndBeat;
    if (this.playbackScheduler) {
      if (this.playbackScheduler.isPlaying()) {
        this.playbackScheduler.stop(false);
      }
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

  private resolvePreviewVisualElapsedMs(): number {
    if (this.previewVisualStartedAtMs === null) {
      return 0;
    }
    return Math.max(window.performance.now() - this.previewVisualStartedAtMs, 0);
  }

  private isPreviewVisualKeepingPlaybackAlive(): boolean {
    return this.previewVisualPhase === 'waiting'
      || this.previewVisualPhase === 'active';
  }

  private async resolveGeneratedPreview(
    input: PreviewGenerationSource,
    purpose: 'preview' | 'send',
  ): Promise<GeneratorPreview> {
    const cachedPreview = this.resolveCachedGeneratedPreview(input);
    if (cachedPreview) {
      return cachedPreview;
    }

    const requestId = this.beginPreviewGeneration(purpose);
    try {
      await waitForNextAnimationFrame();
      const preview = await this.previewGenerator.generate({
        sourceChain: input.sourceChain,
        loopLengthBeats: input.loopLengthBeats,
        launchpadModel: input.launchpadModel,
      });

      if (requestId !== this.previewGenerationRequestId) {
        throw new Error('Preview generation cancelled');
      }

      this.latestGeneratedPreview = {
        sourceKey: input.sourceKey,
        loopLengthBeats: input.loopLengthBeats,
        launchpadModel: input.launchpadModel,
        preview,
      };
      return preview;
    } finally {
      if (requestId === this.previewGenerationRequestId) {
        this.state.isPreviewGenerating = false;
        this.previewGenerationPurpose = null;
      }
    }
  }

  private beginPreviewGeneration(purpose: 'preview' | 'send'): number {
    this.previewGenerationRequestId += 1;
    this.previewGenerationPurpose = purpose;
    this.state.isPreviewGenerating = true;
    this.pausePlaybackForPreviewGeneration();
    return this.previewGenerationRequestId;
  }

  private pausePlaybackForPreviewGeneration(): void {
    if (
      this.previewVisualPhase === 'waiting'
      || this.previewVisualPhase === 'active'
    ) {
      this.previewVisualPhase = 'armed';
      this.previewVisualStartedAtMs = null;
    }
    this.stopPlayback();
  }

  private resolveCachedGeneratedPreview(input: PreviewGenerationSource): GeneratorPreview | null {
    const cached = this.latestGeneratedPreview;
    if (
      cached
      && cached.sourceKey === input.sourceKey
      && cached.loopLengthBeats === input.loopLengthBeats
      && cached.launchpadModel === input.launchpadModel
    ) {
      return cached.preview;
    }

    return null;
  }
}

export const createPlaybackSession = (
  options: PlaybackSessionOptions,
): PlaybackSessionController => new PlaybackSessionController(options);

const waitForNextAnimationFrame = (): Promise<void> =>
  new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });

const isPreviewGenerationCancelled = (error: unknown): boolean =>
  error instanceof Error && error.message === 'Preview generation cancelled';
