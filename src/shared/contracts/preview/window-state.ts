import type { GeneratorChain, LaunchpadModel } from '../../model';

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
  isGuideEnabled: boolean;
}
