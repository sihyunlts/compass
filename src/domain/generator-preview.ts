import type { GeneratorPreview } from '../shared/contracts/preview/generator-preview';
import {
  type GeneratedRuntimeFieldResult,
} from './field-result';
import { toClipNote } from './note-utils';

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
