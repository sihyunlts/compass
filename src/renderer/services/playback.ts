import { clamp } from '../../shared/math';
import type {
  CompassApi,
  GeneratorChain,
  GeneratorPreview,
  LaunchpadModel,
  PreviewWindowState,
} from '../../shared/types';
import { cloneChainForIpc } from './clone-chain';

/**
 * Renderer playback boundary for timeline scheduling and preview-window state sync.
 * Keeps frame timing and IPC payload shaping centralized for the main app view.
 */
/** Configures beat scheduling callbacks for renderer playback. */
export interface PlaybackSchedulerOptions {
  getLoopMs: () => number;
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
    this.currentBeat = clamp(nextBeat, 0, 1);
    if (emitFrame) {
      this.options.onFrame(this.currentBeat);
    }
  }

  public start(): void {
    if (this.isPlayingNow) {
      return;
    }

    if (this.currentBeat >= 1) {
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

    if (this.currentBeat >= 1) {
      if (this.options.isLoopEnabled()) {
        this.currentBeat %= 1;
      } else {
        this.currentBeat = 1;
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
}

/** Creates a requestAnimationFrame scheduler that advances beat progress in `[0, 1]`. */
export const createPlaybackScheduler = (
  options: PlaybackSchedulerOptions,
): PlaybackScheduler => new PlaybackScheduler(options);

/** Snapshot payload used when pushing preview state to the popout window. */
export interface PreviewWindowStateSnapshot {
  activeVelocityByPitch: ReadonlyMap<number, number>;
  previewRevision: number;
  currentBeat: number;
  loopLengthBeats: number;
  launchpadModel: LaunchpadModel;
  noteCount: number;
  uniquePitchCount: number;
  bpm: number;
  isPlaying: boolean;
  isLoopEnabled: boolean;
  isGuideEnabled: boolean;
  resolveChain: () => GeneratorChain;
}

/** Configures preview-window state push behavior and LED color mapping. */
export interface PreviewWindowStatePusherOptions {
  bridgeClient: CompassApi;
  minIntervalMs: number;
  resolveLedRgb: (velocity: number) => string;
  now?: () => number;
}

class PreviewWindowStatePusher {
  private lastPushedMs = 0;

  private lastMetaKey = '';

  private lastPreviewRevision: number | null = null;

  private lastClonedChain: GeneratorChain | null = null;

  public constructor(private readonly options: PreviewWindowStatePusherOptions) {}

  public push(snapshot: PreviewWindowStateSnapshot): void {
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
      || !chainForIpc
    ) {
      chainForIpc = cloneChainForIpc(snapshot.resolveChain());
      this.lastPreviewRevision = snapshot.previewRevision;
      this.lastClonedChain = chainForIpc;
    }

    const nextState: PreviewWindowState = {
      activeCells: this.toActiveCells(snapshot.activeVelocityByPitch),
      previewRevision: snapshot.previewRevision,
      chain: chainForIpc,
      launchpadModel: snapshot.launchpadModel,
      currentBeat: clamp(snapshot.currentBeat, 0, 1),
      loopLengthBeats: Math.max(snapshot.loopLengthBeats, 0.25),
      noteCount: snapshot.noteCount,
      uniquePitchCount: snapshot.uniquePitchCount,
      bpm: snapshot.bpm,
      isPlaying: snapshot.isPlaying,
      isLoopEnabled: snapshot.isLoopEnabled,
      isGuideEnabled: snapshot.isGuideEnabled,
    };

    this.lastPushedMs = now;
    this.lastMetaKey = nextMetaKey;
    this.options.bridgeClient.pushPreviewWindowState(nextState);
  }

  public reset(): void {
    this.lastPushedMs = 0;
    this.lastMetaKey = '';
    this.lastPreviewRevision = null;
    this.lastClonedChain = null;
  }

  private toActiveCells(
    activeVelocityByPitch: ReadonlyMap<number, number>,
  ): PreviewWindowState['activeCells'] {
    const activeCells: PreviewWindowState['activeCells'] = [];
    for (const [pitch, velocity] of activeVelocityByPitch.entries()) {
      activeCells.push({
        pitch,
        rgb: this.options.resolveLedRgb(velocity),
      });
    }
    return activeCells;
  }
}

/** Creates a throttled pusher for preview-window IPC state updates. */
export const createPreviewWindowStatePusher = (
  options: PreviewWindowStatePusherOptions,
): PreviewWindowStatePusher => new PreviewWindowStatePusher(options);

/** Returns the highest active velocity per pitch at the given beat. */
export const collectActiveVelocityByPitch = (
  preview: GeneratorPreview | null,
  beat: number,
): Map<number, number> => {
  const active = new Map<number, number>();

  if (!preview) {
    return active;
  }

  for (const note of preview.notes) {
    const start = note.startBeat;
    const end = note.startBeat + note.durationBeats;
    if (beat < start || beat >= end) {
      continue;
    }

    const prev = active.get(note.pitch) ?? 0;
    if (note.velocity > prev) {
      active.set(note.pitch, note.velocity);
    }
  }

  return active;
};
