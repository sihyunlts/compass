import type { LedCell, LedTape } from './types';
import { toRoundedCoordinateKey } from './coordinates';

export interface LedActivationSegment {
  originId: string;
  originGroupId: string | null;
  x: number;
  y: number;
  velocity: number;
  startBeat: number;
  endBeat: number;
}

interface RoundedWinnerCell {
  originId: string;
  originGroupId: string | null;
  x: number;
  y: number;
  velocity: number;
  writeOrder: number;
  writeId: number;
}

const shouldReplaceWinner = (
  candidate: LedCell,
  current: RoundedWinnerCell,
): boolean => (
  candidate.writeOrder > current.writeOrder
  || (candidate.writeOrder === current.writeOrder && candidate.writeId > current.writeId)
);

export const collectActivationSegments = (
  tape: LedTape,
  predicate: (cell: LedCell) => boolean,
): LedActivationSegment[] => {
  const segments: LedActivationSegment[] = [];
  const activeSegmentByKey = new Map<string, LedActivationSegment>();

  for (let frameIndex = 0; frameIndex < tape.frames.length; frameIndex += 1) {
    const frameStartBeat = frameIndex * tape.sampleStepBeats;
    const frameEndBeat = frameStartBeat + tape.sampleStepBeats;
    const winnerByKey = new Map<string, RoundedWinnerCell>();

    for (const cell of tape.frames[frameIndex].cells) {
      if (!predicate(cell)) {
        continue;
      }

      const coordinateKey = toRoundedCoordinateKey(cell.x, cell.y);
      if (!coordinateKey) {
        continue;
      }

      const roundedX = Math.round(cell.x);
      const roundedY = Math.round(cell.y);
      const winnerKey = `${cell.originId}:${coordinateKey}`;
      const existingWinner = winnerByKey.get(winnerKey);
      if (existingWinner && !shouldReplaceWinner(cell, existingWinner)) {
        continue;
      }

      winnerByKey.set(winnerKey, {
        originId: cell.originId,
        originGroupId: cell.originGroupId,
        x: roundedX,
        y: roundedY,
        velocity: cell.velocity,
        writeOrder: cell.writeOrder,
        writeId: cell.writeId,
      });
    }

    for (const [winnerKey, segment] of activeSegmentByKey.entries()) {
      const winner = winnerByKey.get(winnerKey);
      if (winner && winner.velocity === segment.velocity) {
        segment.endBeat = frameEndBeat;
        winnerByKey.delete(winnerKey);
        continue;
      }

      segments.push(segment);
      activeSegmentByKey.delete(winnerKey);
    }

    for (const [winnerKey, winner] of winnerByKey.entries()) {
      activeSegmentByKey.set(winnerKey, {
        originId: winner.originId,
        originGroupId: winner.originGroupId,
        x: winner.x,
        y: winner.y,
        velocity: winner.velocity,
        startBeat: frameStartBeat,
        endBeat: frameEndBeat,
      });
    }
  }

  segments.push(...activeSegmentByKey.values());
  return segments;
};
