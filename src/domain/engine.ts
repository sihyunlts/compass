import type { ClipNote } from '../shared/model';
import { buildGeneratedNotes } from './note-export';
import {
  type GenerateNotesInput,
  type PreviewNotesData,
  type PreviewStats,
} from './note-generation-types';
import { toClipNote } from './note-utils';

export {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type GenerateNotesInput,
  type PreviewNotesData,
  type PreviewStats,
} from './note-generation-types';

/** Generates clip notes from one chain and one Launchpad model. */
export const generatePreviewNotesData = ({
  chain,
  loopLengthBeats,
  launchpadModel,
}: GenerateNotesInput): PreviewNotesData => {
  const generated = buildGeneratedNotes({
    chain,
    loopLengthBeats,
    launchpadModel,
  });

  return {
    notes: generated.notes.map((note) => toClipNote(note)),
    sourceTimelineEndBeat: generated.sourceTimelineEndBeat,
  };
};

/** Counts total notes and unique pitches (deduped by pitch value). */
export const generatePreviewStats = (notes: ReadonlyArray<ClipNote>): PreviewStats => {
  const uniquePitches = new Set<number>();
  for (const note of notes) {
    uniquePitches.add(note.pitch);
  }

  return {
    noteCount: notes.length,
    uniquePitchCount: uniquePitches.size,
  };
};
