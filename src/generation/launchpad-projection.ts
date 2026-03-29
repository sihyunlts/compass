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
import {
  type CanonicalOutputAdapter,
  type CanonicalSpatialMask,
  type GeometryMask,
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
  stroke: GeometryStroke;
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
  masks: ReadonlyArray<GeometryMask>,
  x: number,
  y: number,
): boolean => masks.every((mask) => {
  const localPoint = applyAffine(mask.inverseTransform, { x, y });
  return mask.contains(localPoint.x, localPoint.y);
});

const isStrokeActiveAtCoordinate = (
  stroke: GeometryStroke,
  x: number,
  y: number,
): boolean => (
  isPointInsideMasks(stroke.masks, x, y)
  && distanceToPolylineSquared({ x, y }, stroke.polyline) <= THICKNESS * THICKNESS
);

const resolveWinnerByCoordinate = (
  strokes: ReadonlyArray<GeometryStroke>,
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): Map<string, WinnerStroke> => {
  const winnerByCoordinate = new Map<string, WinnerStroke>();

  for (const [coordinateKey, coordinateGroup] of coordinateGroupByKey.entries()) {
    for (const stroke of strokes) {
      if (!isVisibleStroke(stroke, mutedGroupIds, mutedGeneratorIds)) {
        continue;
      }
      if (!isStrokeActiveAtCoordinate(stroke, coordinateGroup.x, coordinateGroup.y)) {
        continue;
      }

      const currentWinner = winnerByCoordinate.get(coordinateKey);
      if (!currentWinner
        || stroke.writeOrder > currentWinner.stroke.writeOrder
        || (stroke.writeOrder === currentWinner.stroke.writeOrder && stroke.writeId > currentWinner.stroke.writeId)) {
        winnerByCoordinate.set(coordinateKey, {
          stroke,
          velocity: stroke.polyline.velocity,
          originId: stroke.polyline.originId,
        });
      }
    }
  }

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
    const frameStartBeat = frameIndex * timeline.sampleStepBeats;
    const frameEndBeat = frameStartBeat + timeline.sampleStepBeats;
    const winnerByCoordinate = resolveWinnerByCoordinate(
      timeline.frames[frameIndex]?.strokes ?? [],
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

export const projectTimelineToNotes = (
  timeline: GeometryTimeline,
  runtimeMap: RuntimeMapData,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): ClipNoteWithOrigin[] => {
  const coordinateGroupByKey = buildCoordinateGroupByKey(runtimeMap.buttonIndex);

  const notes = collectPitchSampledNotes({
    sampleCount: timeline.frames.length,
    endBeat: timeline.timeDomainEndBeat,
    sampleStepBeats: timeline.sampleStepBeats,
    minimumNoteDuration: MIN_NOTE_DURATION,
    resolveActiveByPitch: (sampleBeat) => {
      const frameIndex = Math.min(
        Math.max(Math.floor(sampleBeat / timeline.sampleStepBeats), 0),
        Math.max(timeline.frames.length - 1, 0),
      );
      return resolveActiveByPitchFromFrameStrokes(
        timeline.frames[frameIndex]?.strokes ?? [],
        coordinateGroupByKey,
        mutedGroupIds,
        mutedGeneratorIds,
      );
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
