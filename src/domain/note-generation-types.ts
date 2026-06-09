import type { GeneratorChain, LaunchpadButton, LaunchpadModel } from '../shared/model';
import type { ButtonIndex } from '../core/pipeline/types';

export interface GenerateNotesInput {
  chain: GeneratorChain;
  loopLengthBeats: number;
  launchpadModel?: LaunchpadModel;
}

export interface RuntimeMapData {
  buttons: ReadonlyArray<LaunchpadButton>;
  buttonIndex: ButtonIndex;
}

export const NORMALIZED_SOURCE_TIMELINE_END_BEAT = 1;
