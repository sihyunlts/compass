import { NOTE_SAMPLES_PER_BEAT } from '../core/pipeline/constants';
import type { BeatRange } from './analysis/types';
import type { LedCell, LedTape } from './types';

export const DEFAULT_SAMPLE_STEP_BEATS = 1 / NOTE_SAMPLES_PER_BEAT;

export const toFrameCount = (
  endBeat: number,
  sampleStepBeats: number,
): number => {
  if (!Number.isFinite(endBeat) || endBeat <= 0 || !Number.isFinite(sampleStepBeats) || sampleStepBeats <= 0) {
    return NOTE_SAMPLES_PER_BEAT;
  }

  return Math.max(Math.ceil(endBeat / sampleStepBeats), 1);
};

const createEmptyFrames = (count: number): LedTape['frames'] =>
  Array.from({ length: Math.max(count, 1) }, () => ({ cells: [] as LedCell[] }));

export const createEmptyTape = (
  sampleStepBeats = DEFAULT_SAMPLE_STEP_BEATS,
  endBeat = 1,
): LedTape => ({
  sampleStepBeats,
  timeDomainEndBeat: Math.max(endBeat, 1),
  frames: createEmptyFrames(toFrameCount(Math.max(endBeat, 1), sampleStepBeats)),
  nextWriteId: 1,
});

export const cloneCell = (cell: LedCell): LedCell => ({ ...cell });

export const cloneTape = (tape: LedTape): LedTape => ({
  sampleStepBeats: tape.sampleStepBeats,
  timeDomainEndBeat: tape.timeDomainEndBeat,
  frames: tape.frames.map((frame) => ({
    cells: frame.cells.map(cloneCell),
  })),
  nextWriteId: tape.nextWriteId,
});

export const ensureTapeFrameCount = (
  tape: LedTape,
  minEndBeat: number,
): void => {
  const safeEndBeat = Number.isFinite(minEndBeat) && minEndBeat > 0
    ? minEndBeat
    : 1;
  const requiredFrameCount = toFrameCount(safeEndBeat, tape.sampleStepBeats);

  while (tape.frames.length < requiredFrameCount) {
    tape.frames.push({ cells: [] });
  }

  if (safeEndBeat > tape.timeDomainEndBeat) {
    tape.timeDomainEndBeat = safeEndBeat;
  }
};

export const clampFrameIndex = (
  frameIndex: number,
  frameCount: number,
): number => {
  if (frameCount <= 0) {
    return 0;
  }

  return Math.min(Math.max(frameIndex, 0), frameCount - 1);
};

export interface FrameWindow {
  startFrame: number;
  endFrameExclusive: number;
}

export const toFrameWindow = (
  range: BeatRange,
  sampleStepBeats: number,
  frameCount: number,
): FrameWindow => {
  if (!Number.isFinite(sampleStepBeats) || sampleStepBeats <= 0 || frameCount <= 0) {
    return {
      startFrame: 0,
      endFrameExclusive: 0,
    };
  }

  const safeStart = Number.isFinite(range.start) ? Math.max(range.start, 0) : 0;
  const safeEnd = Number.isFinite(range.end) ? Math.max(range.end, safeStart) : safeStart;
  const startFrame = Math.min(
    Math.max(Math.floor(safeStart / sampleStepBeats), 0),
    frameCount,
  );
  const endFrameExclusive = Math.min(
    Math.max(Math.ceil(safeEnd / sampleStepBeats), startFrame),
    frameCount,
  );

  return {
    startFrame,
    endFrameExclusive,
  };
};

export const addCellToFrame = (
  tape: LedTape,
  frameIndex: number,
  cell: Omit<LedCell, 'writeId'>,
): void => {
  const safeFrameIndex = clampFrameIndex(frameIndex, tape.frames.length);
  tape.frames[safeFrameIndex].cells.push({
    ...cell,
    writeId: tape.nextWriteId,
  });
  tape.nextWriteId += 1;
};

export const finalizeTape = (
  tape: LedTape,
): LedTape => {
  let lastActiveIndex = -1;

  for (let index = tape.frames.length - 1; index >= 0; index -= 1) {
    if (tape.frames[index].cells.length > 0) {
      lastActiveIndex = index;
      break;
    }
  }

  const endBeat = lastActiveIndex >= 0
    ? (lastActiveIndex + 1) * tape.sampleStepBeats
    : 1;
  const frameCount = toFrameCount(Math.max(endBeat, 1), tape.sampleStepBeats);

  return {
    sampleStepBeats: tape.sampleStepBeats,
    timeDomainEndBeat: Math.max(endBeat, 1),
    frames: tape.frames.slice(0, frameCount).map((frame) => ({
      cells: frame.cells.map(cloneCell),
    })),
    nextWriteId: tape.nextWriteId,
  };
};
