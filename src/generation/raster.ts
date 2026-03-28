import { GENERATED_VELOCITY, MIN_NOTE_DURATION, POLYLINE_STEP, THICKNESS, buildWorldBounds } from '../core/pipeline/constants';
import { collectPitchSampledNotes, type SampledActivePitch } from '../core/pipeline/note-sampling';
import { distanceToPolylineSquared } from '../core/geometry';
import { buildPathPolyline } from '../core/generators/path';
import { buildScannerPolyline } from '../core/generators/scanner';
import { buildSpiralPolyline } from '../core/generators/spiral';
import { buildWaterdropPolyline } from '../core/generators/waterdrop';
import { sortClipNotes } from '../domain/note-utils';
import type { RuntimeMapData } from '../domain/note-generation-types';
import { normalizeOptionalId } from '../shared/normalize-id';
import type { GeneratorNode, LaunchpadButton } from '../shared/model';
import type { ClipNoteWithOrigin } from '../devices/color/color-program';
import type { LedCell, LedFrameVelocityEntry, LedTape } from './types';
import { addCellToFrame } from './tape';

interface CoordinateGroup {
  x: number;
  y: number;
  buttons: ReadonlyArray<LaunchpadButton>;
}

const TILE_MIN = 0;
const TILE_MAX = 9;
const TILE_COUNT = 10;
const RASTER_LIMIT = 4096;

export const buildCoordinateGroupByKey = (
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

export const buildButtonCoordinateByAddress = (
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

export const toRoundedCoordinateKey = (
  x: number,
  y: number,
): string | null => {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return `${Math.round(x)},${Math.round(y)}`;
};

export const toRoundedTileId = (
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

const normalizeRangeStart = (value: number): number =>
  Math.max(Math.floor(value), -RASTER_LIMIT);

const normalizeRangeEnd = (value: number): number =>
  Math.min(Math.ceil(value), RASTER_LIMIT);

const buildGeneratorPolyline = (
  device: GeneratorNode,
  beat01: number,
) => {
  if (device.kind === 'waterdrop') {
    return buildWaterdropPolyline(
      device.id,
      device.params,
      beat01,
      POLYLINE_STEP,
      GENERATED_VELOCITY,
    );
  }

  if (device.kind === 'scanner') {
    return buildScannerPolyline(
      device.id,
      device.params,
      beat01,
      POLYLINE_STEP,
      GENERATED_VELOCITY,
      buildWorldBounds(),
    );
  }

  if (device.kind === 'spiral') {
    return buildSpiralPolyline(
      device.id,
      device.params,
      beat01,
      POLYLINE_STEP,
      GENERATED_VELOCITY,
    );
  }

  return buildPathPolyline(
    device.id,
    device.params,
    GENERATED_VELOCITY,
  );
};

export const rasterizeGeneratorFrame = (
  tape: LedTape,
  frameIndex: number,
  device: GeneratorNode,
  writeOrder: number,
): void => {
  const beat = frameIndex * tape.sampleStepBeats;
  const polyline = buildGeneratorPolyline(device, Math.min(Math.max(beat, 0), 1));
  if (!polyline || polyline.points.length === 0) {
    return;
  }

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of polyline.points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return;
  }

  const startX = normalizeRangeStart(minX - THICKNESS);
  const endX = normalizeRangeEnd(maxX + THICKNESS);
  const startY = normalizeRangeStart(minY - THICKNESS);
  const endY = normalizeRangeEnd(maxY + THICKNESS);
  const thicknessSq = THICKNESS * THICKNESS;
  const originGroupId = normalizeOptionalId(device.groupId);

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      if (distanceToPolylineSquared({ x, y }, polyline) > thicknessSq) {
        continue;
      }

      addCellToFrame(tape, frameIndex, {
        x,
        y,
        velocity: polyline.velocity,
        originId: device.id,
        originGroupId,
        writeOrder,
      });
    }
  }
};

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

export const buildLedFramesBySampleIndexFromNotes = (
  notes: ReadonlyArray<ClipNoteWithOrigin>,
  sourceTimelineEndBeat: number,
  sampleStepBeats: number,
): ReadonlyArray<ReadonlyArray<LedFrameVelocityEntry>> => {
  const safeSourceTimelineEndBeat = Number.isFinite(sourceTimelineEndBeat) && sourceTimelineEndBeat > 0
    ? sourceTimelineEndBeat
    : 1;
  const safeSampleStepBeats = Number.isFinite(sampleStepBeats) && sampleStepBeats > 0
    ? sampleStepBeats
    : 1 / 256;
  const sampleCount = Math.max(Math.ceil(safeSourceTimelineEndBeat / safeSampleStepBeats), 1);

  return Array.from({ length: sampleCount }, (_, sampleIndex) => {
    const beat = sampleIndex * safeSampleStepBeats;
    const activeVelocityByPitch = new Map<number, number>();

    for (const note of notes) {
      const noteStart = note.startBeat;
      const noteEnd = note.startBeat + Math.max(note.durationBeats, 0);
      if (!(noteStart <= beat && beat < noteEnd)) {
        continue;
      }

      const previousVelocity = activeVelocityByPitch.get(note.pitch) ?? 0;
      if (note.velocity > previousVelocity) {
        activeVelocityByPitch.set(note.pitch, note.velocity);
      }
    }

    return Array.from(activeVelocityByPitch.entries())
      .map(([pitch, velocity]) => [pitch, velocity] as const);
  });
};
