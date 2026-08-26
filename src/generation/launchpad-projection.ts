import { MIN_NOTE_DURATION, THICKNESS } from '../core/pipeline/constants';
import { collectPitchSampledNotes, type SampledActivePitch } from '../core/pipeline/note-sampling';
import {
  applyAffine,
  COMPOSITION_BOUNDS,
  distanceToRasterizedPolylineSquared,
} from '../core/geometry';
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
  collectStrokeOccupiedCoordinateCandidates,
  createOccupiedCoordinate,
  shouldReplaceOccupiedCoordinate,
  type OccupiedCoordinate,
  type OccupiedCoordinateCandidateBounds,
} from './timeline/analysis';
import {
  type CanonicalOutputAdapter,
  type CanonicalSpatialMask,
  type GeometryStroke,
  type GeometryTimeline,
  type GenerationTimelineWindow,
} from './types';
import {
  coordinateKeySetContainsPoint,
  toRoundedCoordinateKey,
} from './coordinates';

interface CoordinateGroup {
  x: number;
  y: number;
  buttons: ReadonlyArray<LaunchpadButton>;
}

interface CoordinateGroupHit {
  coordinateGroup: CoordinateGroup;
  distanceSquared: number;
}

/**
 * Stores output-space facts that depend only on geometry and masks. Visibility
 * keeps only whether any mapped note is hit, while final projection retains the
 * matching integer and fractional coordinate groups.
 */
interface StrokeOutputProjection {
  noteOutputHit?: boolean;
  integerCoordinateHits?: ReadonlyArray<CoordinateGroupHit>;
  fractionalCoordinateHits?: ReadonlyArray<CoordinateGroupHit>;
}

type ResolveStrokeOutputProjection = (
  stroke: GeometryStroke,
) => StrokeOutputProjection;

interface LaunchpadProjectionContext {
  outputAdapter: CanonicalOutputAdapter;
  projectTimelineToActivePitchesBySampleIndex(
    timeline: GeometryTimeline,
    mutedGroupIds: ReadonlySet<string>,
    mutedGeneratorIds: ReadonlySet<string>,
  ): ReadonlyArray<ReadonlyMap<number, SampledActivePitch>>;
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

const resolveCoordinateGroupBounds = (
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
): OccupiedCoordinateCandidateBounds | null => {
  let bounds: OccupiedCoordinateCandidateBounds | null = null;
  for (const coordinateGroup of coordinateGroupByKey.values()) {
    if (bounds) {
      bounds.minX = Math.min(bounds.minX, coordinateGroup.x);
      bounds.maxX = Math.max(bounds.maxX, coordinateGroup.x);
      bounds.minY = Math.min(bounds.minY, coordinateGroup.y);
      bounds.maxY = Math.max(bounds.maxY, coordinateGroup.y);
    } else {
      bounds = {
        minX: coordinateGroup.x,
        maxX: coordinateGroup.x,
        minY: coordinateGroup.y,
        maxY: coordinateGroup.y,
      };
    }
  }
  return bounds;
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
  contains: (x, y) => coordinateKeySetContainsPoint(coordinateKeys, x, y),
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
): boolean => {
  if (!isPointInsideMasks(stroke, x, y)) {
    return false;
  }

  if (
    stroke.polyline.rasterMode === 'centerline'
    && (
      stroke.polyline.points.length === 1
      || (Number.isInteger(x) && Number.isInteger(y))
    )
  ) {
    return collectStrokeOccupiedCoordinateCandidates(stroke).some(
      (coordinate) => coordinate.x === x && coordinate.y === y,
    );
  }

  return distanceToRasterizedPolylineSquared({ x, y }, stroke.polyline)
    <= THICKNESS * THICKNESS;
};

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

const buildProjectionGeometryKey = (
  stroke: GeometryStroke,
  resolveMaskFunctionId: (contains: GeometryStroke['masks'][number]['contains']) => number,
): string => [
  stroke.polyline.closed ? 'closed' : 'open',
  stroke.polyline.rasterMode ?? 'stroke',
  stroke.polyline.rasterTieBreakDirection?.x ?? 'no-tie-x',
  stroke.polyline.rasterTieBreakDirection?.y ?? 'no-tie-y',
  ...stroke.masks.map((mask) => {
    const transform = mask.inverseTransform;
    return [
      resolveMaskFunctionId(mask.contains),
      transform.a,
      transform.b,
      transform.c,
      transform.d,
      transform.tx,
      transform.ty,
    ].join(',');
  }),
].join(':');

const createStrokeOutputProjectionResolver = (): ResolveStrokeOutputProjection => {
  // Canonical generation treats strokes, points, and masks as immutable
  // snapshots. Keeping this cache inside one projection context makes that
  // lifetime explicit and prevents results from leaking across generations.
  const projectionByStroke = new WeakMap<GeometryStroke, StrokeOutputProjection>();
  const projectionByPoints = new WeakMap<
    GeometryStroke['polyline']['points'],
    Map<string, StrokeOutputProjection>
  >();
  const maskFunctionIdByContains = new WeakMap<
    GeometryStroke['masks'][number]['contains'],
    number
  >();
  let nextMaskFunctionId = 1;

  const resolveMaskFunctionId = (
    contains: GeometryStroke['masks'][number]['contains'],
  ): number => {
    const cached = maskFunctionIdByContains.get(contains);
    if (cached) {
      return cached;
    }

    const id = nextMaskFunctionId;
    nextMaskFunctionId += 1;
    maskFunctionIdByContains.set(contains, id);
    return id;
  };

  return (stroke) => {
    const strokeCached = projectionByStroke.get(stroke);
    if (strokeCached) {
      return strokeCached;
    }

    const geometryKey = buildProjectionGeometryKey(stroke, resolveMaskFunctionId);
    const pointsCached = projectionByPoints.get(stroke.polyline.points)?.get(geometryKey);
    if (pointsCached) {
      projectionByStroke.set(stroke, pointsCached);
      return pointsCached;
    }

    const projection: StrokeOutputProjection = {};
    const projectionsForPoints = projectionByPoints.get(stroke.polyline.points) ?? new Map();
    projectionsForPoints.set(geometryKey, projection);
    projectionByPoints.set(stroke.polyline.points, projectionsForPoints);
    projectionByStroke.set(stroke, projection);
    return projection;
  };
};

const resolveStrokeHitsNoteOutput = (
  stroke: GeometryStroke,
  noteOutputCoordinateGroups: ReadonlyArray<CoordinateGroup>,
  resolveStrokeOutputProjection: ResolveStrokeOutputProjection,
): boolean => {
  const projection = resolveStrokeOutputProjection(stroke);
  if (projection.noteOutputHit !== undefined) {
    return projection.noteOutputHit;
  }

  const result = doesStrokeHitNoteOutput(stroke, noteOutputCoordinateGroups);
  projection.noteOutputHit = result;
  return result;
};

const resolveIntegerCoordinateHits = (
  stroke: GeometryStroke,
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
  outputBounds: OccupiedCoordinateCandidateBounds | null,
  resolveStrokeOutputProjection: ResolveStrokeOutputProjection,
): ReadonlyArray<CoordinateGroupHit> => {
  const projection = resolveStrokeOutputProjection(stroke);
  if (projection.integerCoordinateHits) {
    return projection.integerCoordinateHits;
  }

  const coordinateHits: CoordinateGroupHit[] = [];
  const occupied = collectStrokeOccupiedCoordinateCandidates(stroke, outputBounds);
  for (const coordinate of occupied) {
    const coordinateKey = toRoundedCoordinateKey(coordinate.x, coordinate.y);
    if (coordinateKey === null) {
      continue;
    }

    const coordinateGroup = coordinateGroupByKey.get(coordinateKey);
    if (coordinateGroup && hasNoteOutput(coordinateGroup)) {
      coordinateHits.push({
        coordinateGroup,
        distanceSquared: coordinate.distanceSquared,
      });
    }
  }

  projection.integerCoordinateHits = coordinateHits;
  return coordinateHits;
};

const resolveFractionalCoordinateHits = (
  stroke: GeometryStroke,
  fractionalCoordinateGroups: ReadonlyArray<CoordinateGroup>,
  resolveStrokeOutputProjection: ResolveStrokeOutputProjection,
): ReadonlyArray<CoordinateGroupHit> => {
  const projection = resolveStrokeOutputProjection(stroke);
  if (projection.fractionalCoordinateHits) {
    return projection.fractionalCoordinateHits;
  }

  const coordinateHits = fractionalCoordinateGroups.flatMap((coordinateGroup) => (
    hasNoteOutput(coordinateGroup)
    && isStrokeActiveAtCoordinate(stroke, coordinateGroup.x, coordinateGroup.y)
      ? [{
          coordinateGroup,
          distanceSquared: distanceToRasterizedPolylineSquared(
            { x: coordinateGroup.x, y: coordinateGroup.y },
            stroke.polyline,
          ),
        }]
      : []
  ));
  projection.fractionalCoordinateHits = coordinateHits;
  return coordinateHits;
};

const buildVisibleWindowByOriginId = (
  timeline: GeometryTimeline,
  noteOutputCoordinateGroups: ReadonlyArray<CoordinateGroup>,
  resolveStrokeOutputProjection: ResolveStrokeOutputProjection,
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
          resolveStrokeOutputProjection,
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

const resolveActiveByPitchFromFrameStrokes = (
  strokes: ReadonlyArray<GeometryStroke>,
  coordinateGroupByKey: ReadonlyMap<string, CoordinateGroup>,
  outputBounds: OccupiedCoordinateCandidateBounds | null,
  fractionalCoordinateGroups: ReadonlyArray<CoordinateGroup>,
  resolveStrokeOutputProjection: ResolveStrokeOutputProjection,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): Map<number, SampledActivePitch> => {
  const activeByPitch = new Map<number, SampledActivePitch>();
  const integerWinnerByCoordinateKey = new Map<string, OccupiedCoordinate>();
  const fractionalWinnerByCoordinateGroup = new Map<CoordinateGroup, OccupiedCoordinate>();

  for (const stroke of strokes) {
    if (!isVisibleStroke(stroke, mutedGroupIds, mutedGeneratorIds)) {
      continue;
    }

    for (const hit of resolveIntegerCoordinateHits(
      stroke,
      coordinateGroupByKey,
      outputBounds,
      resolveStrokeOutputProjection,
    )) {
      const { coordinateGroup } = hit;
      const coordinateKey = toRoundedCoordinateKey(coordinateGroup.x, coordinateGroup.y);
      if (coordinateKey === null) {
        continue;
      }

      const current = integerWinnerByCoordinateKey.get(coordinateKey);
      const candidate = createOccupiedCoordinate(
        stroke,
        coordinateGroup.x,
        coordinateGroup.y,
        hit.distanceSquared,
      );
      if (!current || shouldReplaceOccupiedCoordinate(candidate, current)) {
        integerWinnerByCoordinateKey.set(coordinateKey, candidate);
      }
    }

    for (const hit of resolveFractionalCoordinateHits(
      stroke,
      fractionalCoordinateGroups,
      resolveStrokeOutputProjection,
    )) {
      const { coordinateGroup } = hit;
      const current = fractionalWinnerByCoordinateGroup.get(coordinateGroup);
      const candidate = createOccupiedCoordinate(
        stroke,
        coordinateGroup.x,
        coordinateGroup.y,
        hit.distanceSquared,
      );
      if (!current || shouldReplaceOccupiedCoordinate(candidate, current)) {
        fractionalWinnerByCoordinateGroup.set(coordinateGroup, candidate);
      }
    }
  }

  for (const [coordinateKey, winner] of integerWinnerByCoordinateKey.entries()) {
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

  for (const coordinateGroup of fractionalCoordinateGroups) {
    const winner = fractionalWinnerByCoordinateGroup.get(coordinateGroup);
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

export const createLaunchpadProjectionContext = (
  runtimeMap: RuntimeMapData,
): LaunchpadProjectionContext => {
  const coordinateGroupByKey = buildCoordinateGroupByKey(runtimeMap.buttonIndex);
  const outputBounds = resolveCoordinateGroupBounds(coordinateGroupByKey);
  const fractionalCoordinateGroups = buildFractionalCoordinateGroups(runtimeMap.buttonIndex);
  const noteOutputCoordinateGroups = buildNoteOutputCoordinateGroups(
    coordinateGroupByKey,
    fractionalCoordinateGroups,
  );
  const coordinateKeyByTileId = buildViewportCoordinateKeyByTileId(runtimeMap.buttonIndex);
  const resolveStrokeOutputProjection = createStrokeOutputProjectionResolver();

  const outputAdapter: CanonicalOutputAdapter = {
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
        resolveStrokeOutputProjection,
        mutedGroupIds,
        mutedGeneratorIds,
      ),
  };

  return {
    outputAdapter,
    projectTimelineToActivePitchesBySampleIndex: (
      timeline,
      mutedGroupIds,
      mutedGeneratorIds,
    ) => timeline.frames.map((frame) => {
      if (frame.strokes.length === 0) {
        return EMPTY_ACTIVE_BY_PITCH;
      }

      return resolveActiveByPitchFromFrameStrokes(
        frame.strokes,
        coordinateGroupByKey,
        outputBounds,
        fractionalCoordinateGroups,
        resolveStrokeOutputProjection,
        mutedGroupIds,
        mutedGeneratorIds,
      );
    }),
  };
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
