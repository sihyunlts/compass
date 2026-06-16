import { MIN_NOTE_DURATION, THICKNESS } from '../core/pipeline/constants';
import { collectPitchSampledNotes, type SampledActivePitch } from '../core/pipeline/note-sampling';
import { applyAffine, COMPOSITION_BOUNDS, distanceToPolylineSquared } from '../core/geometry';
import {
  NORMALIZED_SOURCE_TIMELINE_END_BEAT,
  type RuntimeMapData,
} from '../domain/note-generation-types';
import { sortClipNotes } from '../domain/note-utils';
import type { ClipNoteWithOrigin } from '../devices/color/color-program';
import type { LaunchpadButton } from '../shared/model';
import { createSpatialBounds } from './analysis/bounds';
import type { CanonicalExecutionRequest } from './analysis/types';
import { collectOccupiedCoordinates } from './timeline/analysis';
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
    if (!Number.isInteger(group.x) || !Number.isInteger(group.y)) {
      continue;
    }

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

const buildFractionalCoordinateGroups = (
  runtimeMap: RuntimeMapData['buttonIndex'],
): CoordinateGroup[] => runtimeMap.groups
  .filter((group) => !Number.isInteger(group.x) || !Number.isInteger(group.y))
  .map((group) => ({
    x: group.x,
    y: group.y,
    buttons: group.buttons,
  }));

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

const buildNoteOutputCoordinateGroups = (
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
  fractionalCoordinateGroups: ReadonlyArray<CoordinateGroup>,
): CoordinateGroup[] => [
  ...Array.from(coordinateGroupByKey.values()),
  ...fractionalCoordinateGroups,
].filter(hasNoteOutput);

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

const isPointInsideMasks = (
  stroke: GeometryStroke,
  x: number,
  y: number,
): boolean => stroke.masks.every((mask) => {
  const localPoint = applyAffine(mask.inverseTransform, { x, y });
  return mask.contains(localPoint.x, localPoint.y);
});

const isStrokeActiveAtCoordinate = (
  stroke: GeometryStroke,
  x: number,
  y: number,
): boolean => (
  isPointInsideMasks(stroke, x, y)
  && distanceToPolylineSquared({ x, y }, stroke.polyline) <= THICKNESS * THICKNESS
);

const doesStrokeHitNoteOutput = (
  stroke: GeometryStroke,
  noteOutputCoordinateGroups: ReadonlyArray<CoordinateGroup>,
): boolean => {
  for (const coordinateGroup of noteOutputCoordinateGroups) {
    if (isStrokeActiveAtCoordinate(stroke, coordinateGroup.x, coordinateGroup.y)) {
      return true;
    }
  }

  return false;
};

const resolveStrokeHitsNoteOutput = (
  stroke: GeometryStroke,
  noteOutputCoordinateGroups: ReadonlyArray<CoordinateGroup>,
  noteOutputHitByStroke: WeakMap<GeometryStroke, boolean>,
): boolean => {
  const cached = noteOutputHitByStroke.get(stroke);
  if (cached !== undefined) {
    return cached;
  }

  const result = doesStrokeHitNoteOutput(stroke, noteOutputCoordinateGroups);
  noteOutputHitByStroke.set(stroke, result);
  return result;
};

const resolveExactCoordinateWinner = (
  coordinateGroup: CoordinateGroup,
  visibleStrokes: ReadonlyArray<GeometryStroke>,
): WinnerStroke | null => {
  let winner: GeometryStroke | null = null;

  for (const stroke of visibleStrokes) {
    if (!isStrokeActiveAtCoordinate(stroke, coordinateGroup.x, coordinateGroup.y)) {
      continue;
    }

    if (
      !winner
      || stroke.writeOrder > winner.writeOrder
      || (stroke.writeOrder === winner.writeOrder && stroke.writeId > winner.writeId)
    ) {
      winner = stroke;
    }
  }

  return winner
    ? {
      velocity: winner.polyline.velocity,
      originId: winner.polyline.originId,
    }
    : null;
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

  return winnerByCoordinate;
};

const buildVisibleWindowByOriginId = (
  timeline: GeometryTimeline,
  noteOutputCoordinateGroups: ReadonlyArray<CoordinateGroup>,
  noteOutputHitByStroke: WeakMap<GeometryStroke, boolean>,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): ReadonlyMap<string, GenerationTimelineWindow> => {
  const windowByOriginId = new Map<string, GenerationTimelineWindow>();

  const updateWindow = (
    originId: string,
    frameStartBeat: number,
    frameEndBeat: number,
  ): void => {
    const existing = windowByOriginId.get(originId);
    if (existing) {
      if (frameStartBeat < existing.start) {
        existing.start = frameStartBeat;
      }
      if (frameEndBeat > existing.end) {
        existing.end = frameEndBeat;
      }
      return;
    }

    windowByOriginId.set(originId, {
      start: frameStartBeat,
      end: frameEndBeat,
    });
  };

  for (let frameIndex = 0; frameIndex < timeline.frames.length; frameIndex += 1) {
    const frameStrokes = timeline.frames[frameIndex]?.strokes ?? [];
    if (frameStrokes.length === 0) {
      continue;
    }

    const frameStartBeat = frameIndex * timeline.sampleStepBeats;
    const frameEndBeat = frameStartBeat + timeline.sampleStepBeats;
    const updatedOriginIds = new Set<string>();
    for (const stroke of frameStrokes) {
      if (
        updatedOriginIds.has(stroke.polyline.originId)
        || !isVisibleStroke(stroke, mutedGroupIds, mutedGeneratorIds)
        || !resolveStrokeHitsNoteOutput(
          stroke,
          noteOutputCoordinateGroups,
          noteOutputHitByStroke,
        )
      ) {
        continue;
      }

      updateWindow(stroke.polyline.originId, frameStartBeat, frameEndBeat);
      updatedOriginIds.add(stroke.polyline.originId);
    }
  }

  return windowByOriginId;
};

export const resolveActiveByPitchFromFrameStrokes = (
  strokes: ReadonlyArray<GeometryStroke>,
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
  mutedGroupIds: ReadonlySet<string> = new Set<string>(),
  mutedGeneratorIds: ReadonlySet<string> = new Set<string>(),
  fractionalCoordinateGroups: ReadonlyArray<CoordinateGroup> = [],
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

  const visibleStrokes = fractionalCoordinateGroups.length === 0
    ? []
    : strokes.filter((stroke) => isVisibleStroke(stroke, mutedGroupIds, mutedGeneratorIds));
  for (const coordinateGroup of fractionalCoordinateGroups) {
    const winner = resolveExactCoordinateWinner(coordinateGroup, visibleStrokes);
    if (!winner) {
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
  const fractionalCoordinateGroups = buildFractionalCoordinateGroups(runtimeMap.buttonIndex);

  return timeline.frames.map((frame) => {
    if (frame.strokes.length === 0) {
      return EMPTY_ACTIVE_BY_PITCH;
    }

    return resolveActiveByPitchFromFrameStrokes(
      frame.strokes,
      coordinateGroupByKey,
      mutedGroupIds,
      mutedGeneratorIds,
      fractionalCoordinateGroups,
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
  const fractionalCoordinateGroups = buildFractionalCoordinateGroups(runtimeMap.buttonIndex);
  const noteOutputCoordinateGroups = buildNoteOutputCoordinateGroups(
    coordinateGroupByKey,
    fractionalCoordinateGroups,
  );
  const noteOutputHitByStroke = new WeakMap<GeometryStroke, boolean>();
  const coordinateKeyByTileId = buildViewportCoordinateKeyByTileId(runtimeMap.buttonIndex);

  return {
    createMaskFromViewportTiles: (tileIds) => createMaskFromCoordinateKeys(
      new Set(
        Array.from(tileIds)
          .map((tileId) => coordinateKeyByTileId.get(tileId))
          .filter((coordinateKey): coordinateKey is string => coordinateKey !== undefined),
      ),
    ),
    buildVisibleWindowByOriginId: (timeline, mutedGroupIds, mutedGeneratorIds) =>
      buildVisibleWindowByOriginId(
        timeline,
        noteOutputCoordinateGroups,
        noteOutputHitByStroke,
        mutedGroupIds,
        mutedGeneratorIds,
      ),
  };
};
