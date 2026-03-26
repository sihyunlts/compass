import type { GeneratorChain, LaunchpadButton, LaunchpadModel } from '../shared/model';
import type { ButtonIndex } from '../core/pipeline/types';
import type { ClipNoteWithOrigin } from '../devices/color/color-program';

export interface GenerateNotesInput {
  chain: GeneratorChain;
  loopLengthBeats: number;
  launchpadModel?: LaunchpadModel;
}

export interface RuntimeMapData {
  buttons: ReadonlyArray<LaunchpadButton>;
  buttonIndex: ButtonIndex;
}

export interface NoteGenerationState {
  chain: GeneratorChain;
  loopLengthBeats: number;
  runtimeMap: RuntimeMapData;
}

export interface GeneratedNotesResult {
  notes: ClipNoteWithOrigin[];
  sourceTimelineEndBeat: number;
}

export const NORMALIZED_SOURCE_TIMELINE_END_BEAT = 1;
