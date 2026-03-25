import type { ClipNote, GeneratorChain, LaunchpadButton, LaunchpadModel } from '../shared/model';
import type { ButtonIndex } from '../core/pipeline/types';
import type { OriginTimelinePolicy } from '../core/pipeline/origin-timeline-policy';
import type { ClipNoteWithOrigin } from '../devices/color/engine';

/** Statistics summary for generated notes. */
export interface PreviewStats {
  noteCount: number;
  uniquePitchCount: number;
}

export interface GenerateNotesInput {
  chain: GeneratorChain;
  loopLengthBeats: number;
  launchpadModel?: LaunchpadModel;
}

export interface PreviewNotesData {
  notes: ClipNote[];
  sourceTimelineEndBeat: number;
}

export interface RuntimeMapData {
  buttons: ReadonlyArray<LaunchpadButton>;
  buttonIndex: ButtonIndex;
  buttonAddressToTileId: Map<string, number>;
}

export interface NoteGenerationState {
  chain: GeneratorChain;
  loopLengthBeats: number;
  runtimeMap: RuntimeMapData;
  checkpointNotesByIndex: Map<number, ClipNoteWithOrigin[]>;
  normalizedSourceNotesByKey: Map<string, ClipNoteWithOrigin[]>;
  originTimelinePolicyByCheckpointIndex: Map<number, Map<string, OriginTimelinePolicy>>;
  originGroupIdByGeneratorId: Map<string, string | null>;
}

export interface GeneratedNotesResult {
  notes: ClipNoteWithOrigin[];
  sourceTimelineEndBeat: number;
}

export const NORMALIZED_SOURCE_TIMELINE_END_BEAT = 1;
