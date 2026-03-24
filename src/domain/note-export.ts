import { SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import { fitNotesToTimeline } from '../core/pipeline/timeline-fit';
import { buildFinalOutputNotes, buildOriginGroupIdByGeneratorId } from './checkpoint-note-evaluator';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type GenerateNotesInput,
  type GeneratedNotesResult,
  type NoteGenerationState,
} from './note-generation-types';
import { buildRuntimeMapData } from './runtime-map';

export const buildGeneratedNotes = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): GeneratedNotesResult => {
  if (!Number.isFinite(loopLengthBeats) || loopLengthBeats <= 0) {
    return {
      notes: [],
      sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    };
  }

  const steps = Math.round(loopLengthBeats * SAMPLES_PER_BEAT);
  if (!Number.isFinite(steps) || steps <= 0) {
    return {
      notes: [],
      sourceTimelineEndBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    };
  }

  const state: NoteGenerationState = {
    chain,
    loopLengthBeats,
    runtimeMap: buildRuntimeMapData(launchpadModel),
    checkpointNotesByIndex: new Map(),
    fittedSourceNotesByKey: new Map(),
    originGroupIdByGeneratorId: buildOriginGroupIdByGeneratorId(chain),
  };
  const fitted = fitNotesToTimeline(buildFinalOutputNotes(state));

  return {
    notes: fitted.fittedNotes,
    sourceTimelineEndBeat: fitted.exportTargetSpan,
  };
};
