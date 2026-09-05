import type { GeneratorChain, LaunchpadModel } from '../../model';
import type { HardwareMidiOutputState } from './hardware-output';
import { clamp } from '../../math';

export const PREVIEW_SCRUB_MAX = 1000;

export interface PreviewTimelineFrameStrip {
  columns: number;
  rows: number;
  frameCount: number;
  /** Consecutive row-major RGB bytes. Zeroed pixels mean the LED is off. */
  data: Uint8Array;
}

export interface PreviewWindowState {
  activeCells: Array<{
    pitch: number;
    rgb: string;
  }>;
  previewRevision: number;
  timelineFrameStrip?: PreviewTimelineFrameStrip;
  launchpadModel?: LaunchpadModel;
  chain: GeneratorChain;
  currentBeat: number;
  sourceTimelineEndBeat: number;
  displayProgress01?: number;
  loopLengthBeats: number;
  noteCount: number;
  uniquePitchCount: number;
  bpm: number;
  isPlaying: boolean;
  isLoopEnabled: boolean;
  hardwareOutput: HardwareMidiOutputState;
}

const resolvePreviewProgress01 = (
  state: Pick<
    PreviewWindowState,
    'currentBeat' | 'displayProgress01' | 'sourceTimelineEndBeat'
  >,
): number => {
  const progress = state.displayProgress01
    ?? state.currentBeat / state.sourceTimelineEndBeat;
  return Number.isFinite(progress) ? clamp(progress, 0, 1) : 0;
};

export const resolvePreviewScrubValue = (
  state: Pick<
    PreviewWindowState,
    'currentBeat' | 'displayProgress01' | 'sourceTimelineEndBeat'
  >,
  scrubMax = PREVIEW_SCRUB_MAX,
): number => Math.round(resolvePreviewProgress01(state) * scrubMax);
