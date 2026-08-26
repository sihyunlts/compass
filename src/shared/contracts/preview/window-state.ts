import type { GeneratorChain, LaunchpadModel } from '../../model';
import type { HardwareMidiOutputState } from './hardware-output';

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
  displayProgress01?: number;
  loopLengthBeats: number;
  noteCount: number;
  uniquePitchCount: number;
  bpm: number;
  isPlaying: boolean;
  isLoopEnabled: boolean;
  hardwareOutput: HardwareMidiOutputState;
}
