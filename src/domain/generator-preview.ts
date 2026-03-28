import type { GeneratorPreview } from '../shared/contracts/preview/generator-preview';
import {
  buildGeneratedFieldResult,
  type GeneratedRuntimeFieldResult,
} from './field-result';
import {
  type GenerateNotesInput,
} from './note-generation-types';
import { toClipNote } from './note-utils';

export {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type GenerateNotesInput,
} from './note-generation-types';

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

/** Builds the canonical preview payload for one chain and one Launchpad model. */
export const buildGeneratorPreview = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): GeneratorPreview => {
  const generated = buildGeneratedFieldResult({
    chain,
    loopLengthBeats,
    launchpadModel,
  });
  return toGeneratorPreview(generated);
};
