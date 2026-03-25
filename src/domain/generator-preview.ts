import type { GeneratorPreview } from '../shared/contracts/preview/generator-preview';
import { buildGeneratedNotes } from './note-export';
import {
  type GenerateNotesInput,
} from './note-generation-types';
import { toClipNote } from './note-utils';

export {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type GenerateNotesInput,
} from './note-generation-types';

/** Builds the canonical preview payload for one chain and one Launchpad model. */
export const buildGeneratorPreview = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): GeneratorPreview => {
  const generated = buildGeneratedNotes({
    chain,
    loopLengthBeats,
    launchpadModel,
  });
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
  };
};
