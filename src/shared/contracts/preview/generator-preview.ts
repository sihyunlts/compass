import type { ClipNote } from '../../model';

export type GeneratorPreviewLedFrame = ReadonlyArray<readonly [pitch: number, velocity: number]>;

export interface GeneratorPreview {
  noteCount: number;
  uniquePitchCount: number;
  notes: ClipNote[];
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
  ledFramesBySampleIndex: ReadonlyArray<GeneratorPreviewLedFrame>;
}
