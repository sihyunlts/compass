import { MIN_NOTE_DURATION, SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import { collectPitchSampledNotes } from '../core/pipeline/note-sampling';
import {
  compilePipelineEngine,
  evaluateExactOutputFrameAtTime,
} from '../core/pipeline/engine';
import type { ClipNoteWithOrigin } from '../devices/color/engine';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type NoteGenerationState,
} from './note-generation-types';
import { sortClipNotes } from './note-utils';

export const buildFinalOutputNotes = (
  state: NoteGenerationState,
): ClipNoteWithOrigin[] => {
  if (!Number.isFinite(state.loopLengthBeats) || state.loopLengthBeats <= 0) {
    return [];
  }

  const sampleCount = Math.round(state.loopLengthBeats * SAMPLES_PER_BEAT);
  if (!Number.isFinite(sampleCount) || sampleCount <= 0) {
    return [];
  }

  const engine = compilePipelineEngine(state.chain, {
    buttons: state.runtimeMap.buttons,
    buttonIndex: state.runtimeMap.buttonIndex,
  });
  const notes: ClipNoteWithOrigin[] = collectPitchSampledNotes({
    sampleCount,
    endBeat: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
    minimumNoteDuration: MIN_NOTE_DURATION,
    resolveActiveByPitch: (sampleBeat) =>
      evaluateExactOutputFrameAtTime(engine, sampleBeat).activationFrame.activeByPitch,
  });

  sortClipNotes(notes);
  return notes;
};
