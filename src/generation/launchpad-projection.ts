import { MIN_NOTE_DURATION } from '../core/pipeline/constants';
import { collectPitchSampledNotes, type SampledActivePitch } from '../core/pipeline/note-sampling';
import { COMPOSITION_BOUNDS } from '../core/geometry';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type RuntimeMapData,
} from '../domain/note-generation-types';
import { sortClipNotes } from '../domain/note-utils';
import type { ClipNoteWithOrigin } from '../devices/color/color-program';
import type { LaunchpadButton } from '../shared/model';
import { createSpatialBounds } from './analysis/bounds';
import type { CanonicalExecutionRequest } from './analysis/types';
import { collectOccupiedCoordinates } from './timeline-analysis';
import {
  type CanonicalOutputAdapter,
  type CanonicalSpatialMask,
  type GeometryStroke,
  type GeometryTimeline,
  type GenerationTimelineWindow,
} from './types';
import { toRoundedCoordinateKey } from './coordinates';

interface CoordinateGroup {
  x: number;
  y: number;
  buttons: ReadonlyArray<LaunchpadButton>;
}

interface WinnerStroke {
  velocity: number;
  originId: string;
}

type OccupiedCoordinate = ReturnType<typeof collectOccupiedCoordinates> extends Map<string, infer T>
  ? T
  : never;

interface BalancedColorSlotGroup {
  slotCount: number;
  candidateByCoordinateKey: Map<string, OccupiedCoordinate[]>;
  slotStatsByIndex: Map<number, {
    originId: string;
    velocity: number;
    xTotal: number;
    yTotal: number;
    count: number;
  }>;
}

const TILE_MIN = 0;
const TILE_MAX = 9;
const TILE_COUNT = 10;
const DEFAULT_EVALUATION_PADDING = 24;

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

const createMaskFromCoordinateKeys = (
  coordinateKeys: ReadonlySet<string>,
): CanonicalSpatialMask => ({
  contains: (x, y) => {
    const coordinateKey = toRoundedCoordinateKey(x, y);
    return coordinateKey !== null && coordinateKeys.has(coordinateKey);
  },
});

const hasNoteOutput = (
  coordinateGroup: CoordinateGroup,
): boolean => coordinateGroup.buttons.some((button) => button.output.kind === 'note');

const EMPTY_ACTIVE_BY_PITCH = new Map<number, SampledActivePitch>();

const isVisibleStroke = (
  stroke: GeometryStroke,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): boolean => {
  if (mutedGeneratorIds.has(stroke.polyline.originId)) {
    return false;
  }

  return !(stroke.originGroupId && mutedGroupIds.has(stroke.originGroupId));
};

const toBalancedColorGroupKey = (
  coordinate: OccupiedCoordinate,
): string | null => {
  if (
    typeof coordinate.colorSlotIndex !== 'number'
    || typeof coordinate.colorSlotCount !== 'number'
    || coordinate.colorSlotCount <= 1
    || typeof coordinate.rasterRadius !== 'number'
    || coordinate.rasterRadius <= 0
  ) {
    return null;
  }

  return [
    coordinate.originId,
    coordinate.originGroupId ?? '',
    coordinate.colorSlotCount,
  ].join('|');
};

const applyBalancedColorSlotWinners = (
  winnerByCoordinate: Map<string, WinnerStroke>,
  visibleStrokes: ReadonlyArray<GeometryStroke>,
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
): void => {
  const rawOccupied = collectOccupiedCoordinates(visibleStrokes, false);
  const groupByKey = new Map<string, BalancedColorSlotGroup>();

  for (const coordinate of rawOccupied.values()) {
    const coordinateKey = toRoundedCoordinateKey(coordinate.x, coordinate.y);
    if (coordinateKey === null || !coordinateGroupByKey.has(coordinateKey)) {
      continue;
    }

    const groupKey = toBalancedColorGroupKey(coordinate);
    if (groupKey === null || typeof coordinate.colorSlotIndex !== 'number' || typeof coordinate.colorSlotCount !== 'number') {
      continue;
    }

    let group = groupByKey.get(groupKey);
    if (!group) {
      group = {
        slotCount: coordinate.colorSlotCount,
        candidateByCoordinateKey: new Map(),
        slotStatsByIndex: new Map(),
      };
      groupByKey.set(groupKey, group);
    }

    const candidates = group.candidateByCoordinateKey.get(coordinateKey) ?? [];
    candidates.push(coordinate);
    group.candidateByCoordinateKey.set(coordinateKey, candidates);

    const slotStats = group.slotStatsByIndex.get(coordinate.colorSlotIndex) ?? {
      originId: coordinate.originId,
      velocity: coordinate.velocity,
      xTotal: 0,
      yTotal: 0,
      count: 0,
    };
    slotStats.xTotal += coordinate.x;
    slotStats.yTotal += coordinate.y;
    slotStats.count += 1;
    group.slotStatsByIndex.set(coordinate.colorSlotIndex, slotStats);
  }

  for (const group of groupByKey.values()) {
    if (group.candidateByCoordinateKey.size === 0 || group.slotStatsByIndex.size < 2) {
      continue;
    }

    const orderedSlots = Array.from(group.slotStatsByIndex.entries())
      .sort(([left], [right]) => left - right);
    const firstStats = orderedSlots[0][1];
    const lastStats = orderedSlots[orderedSlots.length - 1][1];
    const firstCenter = {
      x: firstStats.xTotal / firstStats.count,
      y: firstStats.yTotal / firstStats.count,
    };
    const lastCenter = {
      x: lastStats.xTotal / lastStats.count,
      y: lastStats.yTotal / lastStats.count,
    };
    const axis = {
      x: lastCenter.x - firstCenter.x,
      y: lastCenter.y - firstCenter.y,
    };
    const axisLength = Math.hypot(axis.x, axis.y);
    const axisX = axisLength > 1e-9 ? axis.x / axisLength : 1;
    const axisY = axisLength > 1e-9 ? axis.y / axisLength : 0;

    const sortedCoordinateKeys = Array.from(group.candidateByCoordinateKey.keys())
      .sort((leftKey, rightKey) => {
        const left = coordinateGroupByKey.get(leftKey);
        const right = coordinateGroupByKey.get(rightKey);
        if (!left || !right) {
          return leftKey.localeCompare(rightKey);
        }

        const projectionDelta = ((left.x * axisX) + (left.y * axisY)) - ((right.x * axisX) + (right.y * axisY));
        return projectionDelta || leftKey.localeCompare(rightKey);
      });

    for (let index = 0; index < sortedCoordinateKeys.length; index += 1) {
      const coordinateKey = sortedCoordinateKeys[index];
      const slotIndex = Math.min(
        group.slotCount - 1,
        Math.floor((index * group.slotCount) / sortedCoordinateKeys.length),
      );
      const slotStats = group.slotStatsByIndex.get(slotIndex);
      if (!slotStats) {
        continue;
      }

      winnerByCoordinate.set(coordinateKey, {
        velocity: slotStats.velocity,
        originId: slotStats.originId,
      });
    }
  }
};

const resolveWinnerByCoordinate = (
  strokes: ReadonlyArray<GeometryStroke>,
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): Map<string, WinnerStroke> => {
  if (strokes.length === 0 || coordinateGroupByKey.size === 0) {
    return new Map<string, WinnerStroke>();
  }

  const visibleStrokes = strokes.filter((stroke) => isVisibleStroke(
    stroke,
    mutedGroupIds,
    mutedGeneratorIds,
  ));
  if (visibleStrokes.length === 0) {
    return new Map<string, WinnerStroke>();
  }

  const winnerByCoordinate = new Map<string, WinnerStroke>();

  const occupied = collectOccupiedCoordinates(visibleStrokes, true, { fillColorSlotGaps: true });
  for (const coordinate of occupied.values()) {
    const coordinateKey = toRoundedCoordinateKey(coordinate.x, coordinate.y);
    if (coordinateKey === null || !coordinateGroupByKey.has(coordinateKey)) {
      continue;
    }

    winnerByCoordinate.set(coordinateKey, {
      velocity: coordinate.velocity,
      originId: coordinate.originId,
    });
  }

  applyBalancedColorSlotWinners(winnerByCoordinate, visibleStrokes, coordinateGroupByKey);

  return winnerByCoordinate;
};

const buildVisibleWindowByOriginId = (
  timeline: GeometryTimeline,
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): ReadonlyMap<string, GenerationTimelineWindow> => {
  const windowByOriginId = new Map<string, GenerationTimelineWindow>();

  for (let frameIndex = 0; frameIndex < timeline.frames.length; frameIndex += 1) {
    const frameStrokes = timeline.frames[frameIndex]?.strokes ?? [];
    if (frameStrokes.length === 0) {
      continue;
    }

    const frameStartBeat = frameIndex * timeline.sampleStepBeats;
    const frameEndBeat = frameStartBeat + timeline.sampleStepBeats;
    const winnerByCoordinate = resolveWinnerByCoordinate(
      frameStrokes,
      coordinateGroupByKey,
      mutedGroupIds,
      mutedGeneratorIds,
    );

    for (const [coordinateKey, winner] of winnerByCoordinate.entries()) {
      const coordinateGroup = coordinateGroupByKey.get(coordinateKey);
      if (!coordinateGroup || !hasNoteOutput(coordinateGroup)) {
        continue;
      }

      const existing = windowByOriginId.get(winner.originId);
      if (existing) {
        if (frameStartBeat < existing.start) {
          existing.start = frameStartBeat;
        }
        if (frameEndBeat > existing.end) {
          existing.end = frameEndBeat;
        }
        continue;
      }

      windowByOriginId.set(winner.originId, {
        start: frameStartBeat,
        end: frameEndBeat,
      });
    }
  }

  return windowByOriginId;
};

export const resolveActiveByPitchFromFrameStrokes = (
  strokes: ReadonlyArray<GeometryStroke>,
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
  mutedGroupIds: ReadonlySet<string> = new Set<string>(),
  mutedGeneratorIds: ReadonlySet<string> = new Set<string>(),
): Map<number, SampledActivePitch> => {
  const activeByPitch = new Map<number, SampledActivePitch>();
  const winnerByCoordinate = resolveWinnerByCoordinate(
    strokes,
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

export const projectTimelineToActivePitchesBySampleIndex = (
  timeline: GeometryTimeline,
  runtimeMap: RuntimeMapData,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): ReadonlyArray<ReadonlyMap<number, SampledActivePitch>> => {
  const coordinateGroupByKey = buildCoordinateGroupByKey(runtimeMap.buttonIndex);

  return timeline.frames.map((frame) => {
    if (frame.strokes.length === 0) {
      return EMPTY_ACTIVE_BY_PITCH;
    }

    return resolveActiveByPitchFromFrameStrokes(
      frame.strokes,
      coordinateGroupByKey,
      mutedGroupIds,
      mutedGeneratorIds,
    );
  });
};

export const projectActivePitchesToNotes = (
  activeByPitchFrames: ReadonlyArray<ReadonlyMap<number, SampledActivePitch>>,
  timeline: Pick<GeometryTimeline, 'timeDomainEndBeat' | 'sampleStepBeats'>,
): ClipNoteWithOrigin[] => {
  const notes = collectPitchSampledNotes({
    sampleCount: activeByPitchFrames.length,
    endBeat: timeline.timeDomainEndBeat,
    sampleStepBeats: timeline.sampleStepBeats,
    minimumNoteDuration: MIN_NOTE_DURATION,
    resolveActiveByPitch: (sampleBeat) => {
      const frameIndex = Math.min(
        Math.max(Math.floor(sampleBeat / timeline.sampleStepBeats), 0),
        Math.max(activeByPitchFrames.length - 1, 0),
      );
      return activeByPitchFrames[frameIndex] ?? EMPTY_ACTIVE_BY_PITCH;
    },
  });

  sortClipNotes(notes);
  return notes;
};

export const createLaunchpadExecutionRequest = (): CanonicalExecutionRequest => ({
  outputBounds: createSpatialBounds(
    COMPOSITION_BOUNDS.minX - DEFAULT_EVALUATION_PADDING,
    COMPOSITION_BOUNDS.maxX + DEFAULT_EVALUATION_PADDING,
    COMPOSITION_BOUNDS.minY - DEFAULT_EVALUATION_PADDING,
    COMPOSITION_BOUNDS.maxY + DEFAULT_EVALUATION_PADDING,
  ),
  timeDomain: {
    start: 0,
    end: NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  },
});

export const createLaunchpadOutputAdapter = (
  runtimeMap: RuntimeMapData,
): CanonicalOutputAdapter => {
  const coordinateGroupByKey = buildCoordinateGroupByKey(runtimeMap.buttonIndex);
  const coordinateKeyByTileId = buildViewportCoordinateKeyByTileId(runtimeMap.buttonIndex);

  return {
    createMaskFromViewportTiles: (tileIds) => createMaskFromCoordinateKeys(
      new Set(
        Array.from(tileIds)
          .map((tileId) => coordinateKeyByTileId.get(tileId))
          .filter((coordinateKey): coordinateKey is string => coordinateKey !== undefined),
      ),
    ),
    buildVisibleWindowByOriginId: (timeline, mutedGroupIds, mutedGeneratorIds) => buildVisibleWindowByOriginId(
      timeline,
      coordinateGroupByKey,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
  };
};
