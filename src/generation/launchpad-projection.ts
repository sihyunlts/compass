import { MIN_NOTE_DURATION } from '../core/pipeline/constants';
import { collectPitchSampledNotes, type SampledActivePitch } from '../core/pipeline/note-sampling';
import type { RuntimeMapData } from '../domain/note-generation-types';
import { sortClipNotes } from '../domain/note-utils';
import type { ClipNoteWithOrigin } from '../devices/color/color-program';
import type { LaunchpadButton } from '../shared/model';
import type { CanonicalSurfaceAdapter, LedCell, LedFrameVelocityEntry, LedTape } from './types';
import { toRoundedCoordinateKey, toRoundedTileId } from './raster';

interface CoordinateGroup {
  x: number;
  y: number;
  buttons: ReadonlyArray<LaunchpadButton>;
}

const buildCoordinateGroupByKey = (
  runtimeMap: RuntimeMapData['buttonIndex'],
): Map<string, CoordinateGroup> => new Map(
  runtimeMap.groups.map((group) => [
    `${group.x},${group.y}`,
    {
      x: group.x,
      y: group.y,
      buttons: group.buttons,
    },
  ]),
);

const buildButtonCoordinateByAddress = (
  buttons: ReadonlyArray<LaunchpadButton>,
): Map<string, { x: number; y: number }> => {
  const coordinates = new Map<string, { x: number; y: number }>();

  for (const button of buttons) {
    if (button.output.kind !== 'note') {
      continue;
    }

    coordinates.set(`${button.output.channel}:${button.output.number}`, {
      x: button.x,
      y: button.y,
    });
  }

  return coordinates;
};

const filterTapeToOrigin = (
  tape: LedTape,
  originId: string,
): LedTape => ({
  ...tape,
  frames: tape.frames.map((frame) => ({
    cells: frame.cells.filter((cell) => cell.originId === originId),
  })),
});

const isVisibleCell = (
  cell: LedCell,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): boolean => {
  if (mutedGeneratorIds.has(cell.originId)) {
    return false;
  }

  return !(cell.originGroupId && mutedGroupIds.has(cell.originGroupId));
};

const resolveWinnerByCoordinate = (
  cells: ReadonlyArray<LedCell>,
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): Map<string, LedCell> => {
  const winnerByCoordinate = new Map<string, LedCell>();

  for (const cell of cells) {
    if (!isVisibleCell(cell, mutedGroupIds, mutedGeneratorIds)) {
      continue;
    }

    const coordinateKey = toRoundedCoordinateKey(cell.x, cell.y);
    if (!coordinateKey || !coordinateGroupByKey.has(coordinateKey)) {
      continue;
    }

    const currentWinner = winnerByCoordinate.get(coordinateKey);
    if (!currentWinner
      || cell.writeOrder > currentWinner.writeOrder
      || (cell.writeOrder === currentWinner.writeOrder && cell.writeId > currentWinner.writeId)) {
      winnerByCoordinate.set(coordinateKey, cell);
    }
  }

  return winnerByCoordinate;
};

export const resolveActiveByPitchFromFrameCells = (
  cells: ReadonlyArray<LedCell>,
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
  mutedGroupIds: ReadonlySet<string> = new Set<string>(),
  mutedGeneratorIds: ReadonlySet<string> = new Set<string>(),
): Map<number, SampledActivePitch> => {
  const activeByPitch = new Map<number, SampledActivePitch>();
  const winnerByCoordinate = resolveWinnerByCoordinate(
    cells,
    coordinateGroupByKey,
    mutedGroupIds,
    mutedGeneratorIds,
  );

  for (const [coordinateKey, winner] of winnerByCoordinate.entries()) {
    const coordinateGroup = coordinateGroupByKey.get(coordinateKey);
    if (!coordinateGroup) {
      continue;
    }

    for (const button of coordinateGroup.buttons) {
      if (button.output.kind !== 'note') {
        continue;
      }

      activeByPitch.set(button.output.number, {
        velocity: winner.velocity,
        channel: button.output.channel,
        originId: winner.originId,
      });
    }
  }

  return activeByPitch;
};

export const resolveProjectedActiveTiles = (
  cells: ReadonlyArray<LedCell>,
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
): Set<number> => {
  const tiles = new Set<number>();
  const winnerByCoordinate = resolveWinnerByCoordinate(
    cells,
    coordinateGroupByKey,
    new Set<string>(),
    new Set<string>(),
  );

  for (const coordinateKey of winnerByCoordinate.keys()) {
    const coordinateGroup = coordinateGroupByKey.get(coordinateKey);
    if (!coordinateGroup) {
      continue;
    }

    const tileId = toRoundedTileId(coordinateGroup.x, coordinateGroup.y);
    if (tileId !== null) {
      tiles.add(tileId);
    }
  }

  return tiles;
};

export const buildLedFramesBySampleIndex = (
  tape: LedTape,
  runtimeMap: RuntimeMapData,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): ReadonlyArray<ReadonlyArray<LedFrameVelocityEntry>> => {
  const coordinateGroupByKey = buildCoordinateGroupByKey(runtimeMap.buttonIndex);

  return tape.frames.map((frame) => Array.from(
    resolveActiveByPitchFromFrameCells(
      frame.cells,
      coordinateGroupByKey,
      mutedGroupIds,
      mutedGeneratorIds,
    ).entries(),
  ).map(([pitch, info]) => [pitch, info.velocity] as const));
};

export const projectTapeToNotes = (
  tape: LedTape,
  runtimeMap: RuntimeMapData,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): ClipNoteWithOrigin[] => {
  const coordinateGroupByKey = buildCoordinateGroupByKey(runtimeMap.buttonIndex);

  const notes = collectPitchSampledNotes({
    sampleCount: tape.frames.length,
    endBeat: tape.timeDomainEndBeat,
    sampleStepBeats: tape.sampleStepBeats,
    minimumNoteDuration: MIN_NOTE_DURATION,
    resolveActiveByPitch: (sampleBeat) => {
      const frameIndex = Math.min(
        Math.max(Math.floor(sampleBeat / tape.sampleStepBeats), 0),
        Math.max(tape.frames.length - 1, 0),
      );
      return resolveActiveByPitchFromFrameCells(
        tape.frames[frameIndex]?.cells ?? [],
        coordinateGroupByKey,
        mutedGroupIds,
        mutedGeneratorIds,
      );
    },
  });

  sortClipNotes(notes);
  return notes;
};

export const createLaunchpadSurfaceAdapter = (
  runtimeMap: RuntimeMapData,
): CanonicalSurfaceAdapter => {
  const coordinateGroupByKey = buildCoordinateGroupByKey(runtimeMap.buttonIndex);
  const buttonCoordinateByAddress = buildButtonCoordinateByAddress(runtimeMap.buttons);

  return {
    projectActivationTiles: (cells) =>
      resolveProjectedActiveTiles(cells, coordinateGroupByKey),
    projectOriginNotes: (tape, originId) => projectTapeToNotes(
      filterTapeToOrigin(tape, originId),
      runtimeMap,
      new Set<string>(),
      new Set<string>(),
    ),
    resolveNoteCoordinate: (note) =>
      buttonCoordinateByAddress.get(`${note.channel}:${note.pitch}`) ?? null,
  };
};
