import type { GeneratorChain, LaunchpadModel } from '../../model';

export const PREVIEW_SCRUB_MAX = 1000;

export interface PreviewWindowState {
  activeCells: Array<{
    pitch: number;
    rgb: string;
  }>;
  previewRevision: number;
  launchpadModel?: LaunchpadModel;
  chain: GeneratorChain;
  currentBeat: number;
  sourceTimelineEndBeat: number;
  loopLengthBeats: number;
  noteCount: number;
  uniquePitchCount: number;
  bpm: number;
  isPlaying: boolean;
  isLoopEnabled: boolean;
}
