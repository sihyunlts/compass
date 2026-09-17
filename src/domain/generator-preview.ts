import type { GeneratorPreview } from '../shared/contracts/preview/generator-preview';
import {
  type GeneratedRuntimeFieldResult,
} from './field-result';
import { scaleClipNoteTimes, toClipNote } from './note-utils';

export const toGeneratorPreview = (
  generated: GeneratedRuntimeFieldResult,
): GeneratorPreview => {
  const notes = generated.notes.map((note) => toClipNote(note));
  const uniquePitches = new Set<number>();

  for (const note of notes) {
    uniquePitches.add(note.pitch);
  }

  return {
    noteCount: notes.length,
    uniquePitchCount: uniquePitches.size,
    notes,
    sourceTimelineEndBeat: generated.sourceTimelineEndBeat,
    sampleStepBeats: generated.sampleStepBeats,
    ledFramesBySampleIndex: generated.ledFramesBySampleIndex,
  };
};

export const scaleGeneratorPreviewToLoopLength = (
  preview: GeneratorPreview,
  loopLengthBeats: number,
): GeneratorPreview => {
  if (preview.sourceTimelineEndBeat === loopLengthBeats) {
    return preview;
  }
  const ratio = loopLengthBeats / preview.sourceTimelineEndBeat;
  return {
    ...preview,
    notes: scaleClipNoteTimes(preview.notes, ratio),
    sourceTimelineEndBeat: loopLengthBeats,
    sampleStepBeats: preview.sampleStepBeats * ratio,
  };
};
