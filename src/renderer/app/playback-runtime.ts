import { clamp } from '../../shared/math';
import { cloneChainForIpc, type GeneratorChain } from '../../shared/model';
import type { PreviewWindowState } from '../../shared/contracts/preview/window-state';
import type { CompassApi } from '../../shared/contracts/ipc/api';

/**
 * Renderer playback boundary for timeline scheduling and preview-window state sync.
 * Keeps frame timing and IPC payload shaping centralized for the main app view.
 */
/** Configures beat scheduling callbacks for renderer playback. */
export interface PlaybackSchedulerOptions {
  getLoopMs: () => number;
  getLoopEndBeat: () => number;
  isLoopEnabled: () => boolean;
  onFrame: (currentBeat: number) => void;
  onPlayStateChange: (isPlaying: boolean) => void;
}

class PlaybackScheduler {
  private currentBeat = 0;

  private isPlayingNow = false;

  private animationFrame: number | null = null;

  private lastFrameTs: number | null = null;

  public constructor(private readonly options: PlaybackSchedulerOptions) {}

  public getCurrentBeat(): number {
    return this.currentBeat;
  }

  public isPlaying(): boolean {
    return this.isPlayingNow;
  }

  public setCurrentBeat(nextBeat: number, emitFrame = true): void {
    this.currentBeat = clamp(nextBeat, 0, this.resolveLoopEndBeat());
    if (emitFrame) {
      this.options.onFrame(this.currentBeat);
    }
  }

  public start(): void {
    if (this.isPlayingNow) {
      return;
    }

    const endBeat = this.resolveLoopEndBeat();
    if (this.currentBeat >= endBeat) {
      this.currentBeat = 0;
      this.options.onFrame(this.currentBeat);
    }

    this.setPlaying(true);
    this.lastFrameTs = null;
    this.animationFrame = window.requestAnimationFrame(this.tick);
  }

  public stop(emitFrame = true): void {
    this.setPlaying(false);
    if (this.animationFrame !== null) {
      window.cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
    this.lastFrameTs = null;
    if (emitFrame) {
      this.options.onFrame(this.currentBeat);
    }
  }

  public teardown(): void {
    this.stop(false);
  }

  private readonly tick = (now: number): void => {
    if (!this.isPlayingNow) {
      return;
    }

    if (this.lastFrameTs === null) {
      this.lastFrameTs = now;
    }

    const delta = now - this.lastFrameTs;
    this.lastFrameTs = now;
    this.currentBeat += delta / this.options.getLoopMs();

    const endBeat = this.resolveLoopEndBeat();
    if (this.currentBeat >= endBeat) {
      if (this.options.isLoopEnabled()) {
        this.currentBeat %= endBeat;
      } else {
        this.currentBeat = endBeat;
        this.options.onFrame(this.currentBeat);
        this.stop(false);
        return;
      }
    }

    this.options.onFrame(this.currentBeat);
    this.animationFrame = window.requestAnimationFrame(this.tick);
  };

  private setPlaying(next: boolean): void {
    if (this.isPlayingNow === next) {
      return;
    }

    this.isPlayingNow = next;
    this.options.onPlayStateChange(next);
  }

  private resolveLoopEndBeat(): number {
    const endBeat = this.options.getLoopEndBeat();
    return Number.isFinite(endBeat) && endBeat > 0 ? endBeat : 1;
  }
}

/** Creates a requestAnimationFrame scheduler that advances beat progress in `[0, endBeat]`. */
export const createPlaybackScheduler = (
  options: PlaybackSchedulerOptions,
): PlaybackScheduler => new PlaybackScheduler(options);

/** Configures preview-window state push behavior and chain cloning. */
export interface PreviewWindowStatePusherOptions {
  bridgeClient: CompassApi;
  minIntervalMs: number;
  now?: () => number;
}

class PreviewWindowStatePusher {
  private lastPushedMs = 0;

  private lastMetaKey = '';

  private lastPreviewRevision: number | null = null;

  private lastSourceChain: GeneratorChain | null = null;

  private lastClonedChain: GeneratorChain | null = null;

  public constructor(private readonly options: PreviewWindowStatePusherOptions) {}

  public push(snapshot: PreviewWindowState): void {
    const nextMetaKey = [
      snapshot.previewRevision,
      snapshot.noteCount,
      snapshot.uniquePitchCount,
      snapshot.bpm.toFixed(2),
      snapshot.isPlaying ? 1 : 0,
      snapshot.isLoopEnabled ? 1 : 0,
      snapshot.isGuideEnabled ? 1 : 0,
    ].join(':');

    const now = this.options.now ? this.options.now() : window.performance.now();
    const isMetaChanged = nextMetaKey !== this.lastMetaKey;
    if (
      snapshot.isPlaying
      && !isMetaChanged
      && now - this.lastPushedMs < this.options.minIntervalMs
    ) {
      return;
    }

    let chainForIpc = this.lastClonedChain;
    if (
      this.lastPreviewRevision !== snapshot.previewRevision
      || this.lastSourceChain !== snapshot.chain
      || !chainForIpc
    ) {
      chainForIpc = cloneChainForIpc(snapshot.chain);
      this.lastPreviewRevision = snapshot.previewRevision;
      this.lastSourceChain = snapshot.chain;
      this.lastClonedChain = chainForIpc;
    }

    this.lastPushedMs = now;
    this.lastMetaKey = nextMetaKey;
    this.options.bridgeClient.pushPreviewWindowState({
      ...snapshot,
      chain: chainForIpc,
      loopLengthBeats: Math.max(snapshot.loopLengthBeats, 0.25),
    });
  }

  public reset(): void {
    this.lastPushedMs = 0;
    this.lastMetaKey = '';
    this.lastPreviewRevision = null;
    this.lastSourceChain = null;
    this.lastClonedChain = null;
  }
}

/** Creates a throttled pusher for preview-window IPC state updates. */
export const createPreviewWindowStatePusher = (
  options: PreviewWindowStatePusherOptions,
): PreviewWindowStatePusher => new PreviewWindowStatePusher(options);
