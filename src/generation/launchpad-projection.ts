import { MIN_NOTE_DURATION } from '../core/pipeline/constants';
import { collectPitchSampledNotes, type SampledActivePitch } from '../core/pipeline/note-sampling';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type RuntimeMapData,
} from '../domain/note-generation-types';
import { sortClipNotes } from '../domain/note-utils';
import type { ClipNoteWithOrigin } from '../devices/color/color-program';
import type { LaunchpadButton } from '../shared/model';
import type { CanonicalExecutionRequest } from './analysis/types';
import {
  type CanonicalSpatialAdapter,
  type CanonicalSpatialMask,
  type LedCell,
  type LedFrameVelocityEntry,
  type LedTape,
} from './types';
import { toRoundedCoordinateKey } from './coordinates';

interface CoordinateGroup {
  x: number;
  y: number;
  buttons: ReadonlyArray<LaunchpadButton>;
}

const TILE_MIN = 0;
const TILE_MAX = 9;
const TILE_COUNT = 10;

const toViewportTileId = (
  x: number,
  y: number,
): number | null => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  const tileX = Math.round(x);
  const tileY = Math.round(y);
  if (tileX < TILE_MIN || tileX > TILE_MAX || tileY < TILE_MIN || tileY > TILE_MAX) {
    return null;
  }

  return tileY * TILE_COUNT + tileX;
};

const buildCoordinateGroupByKey = (
  runtimeMap: RuntimeMapData['buttonIndex'],
): Map<string, CoordinateGroup> => {
  const coordinateGroupByKey = new Map<string, CoordinateGroup>();

  for (const group of runtimeMap.groups) {
    const coordinateKey = toRoundedCoordinateKey(group.x, group.y);
    if (!coordinateKey) {
      continue;
    }

    coordinateGroupByKey.set(coordinateKey, {
      x: group.x,
      y: group.y,
      buttons: group.buttons,
    });
  }

  return coordinateGroupByKey;
};

const buildViewportCoordinateKeyByTileId = (
  runtimeMap: RuntimeMapData['buttonIndex'],
): Map<number, string> => {
  const coordinateKeyByTileId = new Map<number, string>();

  for (const group of runtimeMap.groups) {
    const tileId = toViewportTileId(group.x, group.y);
    const coordinateKey = toRoundedCoordinateKey(group.x, group.y);
    if (tileId === null || !coordinateKey) {
      continue;
    }

    coordinateKeyByTileId.set(tileId, coordinateKey);
  }

  return coordinateKeyByTileId;
};

const buildViewportBounds = (
  runtimeMap: RuntimeMapData['buttonIndex'],
): CanonicalExecutionRequest['outputBounds'] => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const group of runtimeMap.groups) {
    if (group.x < minX) minX = group.x;
    if (group.x > maxX) maxX = group.x;
    if (group.y < minY) minY = group.y;
    if (group.y > maxY) maxY = group.y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return 'none';
  }

  return { minX, maxX, minY, maxY };
};

const createMaskFromCoordinateKeys = (
  coordinateKeys: ReadonlySet<string>,
): CanonicalSpatialMask => ({
  contains: (x, y) => {
    const coordinateKey = toRoundedCoordinateKey(x, y);
    return coordinateKey !== null && coordinateKeys.has(coordinateKey);
  },
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

const resolveActivationMaskCoordinateKeys = (
  cells: ReadonlyArray<LedCell>,
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
): Set<string> => new Set(
  resolveWinnerByCoordinate(
    cells,
    coordinateGroupByKey,
    new Set<string>(),
    new Set<string>(),
  ).keys(),
);

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

export const createLaunchpadExecutionRequest = (
  runtimeMap: RuntimeMapData,
): CanonicalExecutionRequest => ({
  outputBounds: buildViewportBounds(runtimeMap.buttonIndex),
  timeDomain: {
    start: 0,
    end: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  },
});

export const createLaunchpadSpatialAdapter = (
  runtimeMap: RuntimeMapData,
): CanonicalSpatialAdapter => {
  const coordinateGroupByKey = buildCoordinateGroupByKey(runtimeMap.buttonIndex);
  const coordinateKeyByTileId = buildViewportCoordinateKeyByTileId(runtimeMap.buttonIndex);

  return {
    createMaskFromSceneCells: (cells) => createMaskFromCoordinateKeys(
      new Set(
        cells
          .map((cell) => toRoundedCoordinateKey(cell.x, cell.y))
          .filter((coordinateKey): coordinateKey is string => coordinateKey !== null),
      ),
    ),
    createMaskFromViewportTiles: (tileIds) => createMaskFromCoordinateKeys(
      new Set(
        Array.from(tileIds)
          .map((tileId) => coordinateKeyByTileId.get(tileId))
          .filter((coordinateKey): coordinateKey is string => coordinateKey !== undefined),
      ),
    ),
    createMaskFromActivationCells: (cells) => createMaskFromCoordinateKeys(
      resolveActivationMaskCoordinateKeys(cells, coordinateGroupByKey),
    ),
  };
};
