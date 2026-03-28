import type { ClipNoteWithOrigin } from '../devices/color/color-program';

export interface LedCell {
  x: number;
  y: number;
  velocity: number;
  originId: string;
  originGroupId: string | null;
  writeOrder: number;
  writeId: number;
}

export interface LedFrame {
  cells: LedCell[];
}

export interface LedTape {
  sampleStepBeats: number;
  timeDomainEndBeat: number;
  frames: LedFrame[];
  nextWriteId: number;
}

export type LedFrameVelocityEntry = readonly [pitch: number, velocity: number];

export interface CanonicalFieldResult {
  tape: LedTape;
  sourceTimelineEndBeat: number;
  sampleStepBeats: number;
  mutedGroupIds: ReadonlySet<string>;
  mutedGeneratorIds: ReadonlySet<string>;
}

export interface CanonicalSurfaceAdapter {
  projectActivationTiles(cells: ReadonlyArray<LedCell>): Set<number>;
  projectOriginNotes(tape: LedTape, originId: string): ClipNoteWithOrigin[];
  resolveNoteCoordinate(note: Pick<ClipNoteWithOrigin, 'channel' | 'pitch'>): { x: number; y: number } | null;
}
