import type { ClipNote } from '../../model';

export interface GeneratorPreview {
  noteCount: number;
  uniquePitchCount: number;
  notes: ClipNote[];
  sourceTimelineEndBeat: number;
}
