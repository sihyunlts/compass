import type { Vec2 } from '../../core/core-types';
import { iterateTimelineFrames, type FrameWindow } from '../timeline';
import type { GeometryStroke, GeometryTimeline } from '../types';

export interface GeometryStateEvent {
  frameIndex: number;
  /** The source holds this pose until the next change or the end of its run. */
  endFrameExclusive: number;
  runIndex: number;
  runStartFrame: number;
  runEndFrameExclusive: number;
  // Non-zero only when this dense pose crosses the next one-LED motion unit.
  motionUnitFrameCount: number;
  strokes: ReadonlyArray<GeometryStroke>;
}

interface GeometryMotionSnapshot {
  probes: Float64Array;
  topologyKey: string;
  isEmpty: boolean;
}

interface ExtractGeometryEventTracksInput {
  timeline: GeometryTimeline;
  targetOriginIds: ReadonlySet<string>;
  frameWindow: FrameWindow;
}

interface MutableGeometryStateEvent extends GeometryStateEvent {
  runEndFrameExclusive: number;
}

interface OriginCaptureState {
  events: MutableGeometryStateEvent[];
  activeRun: {
    lastSample: GeometryMotionSnapshot;
    motionUnitAnchor: GeometryMotionSnapshot;
    movingFrameCountSinceUnit: number;
  } | null;
  runIndex: number;
  runStartFrame: number;
}

const MOTION_UNIT_DISTANCE_LED = 1;
const PROBE_STEP_LED = 0.25;
const GEOMETRY_DISTANCE_EPSILON = 1e-6;
const SAMPLE_MOTION_DISTANCE_LED = 1e-4;
type SpatialCellKey = number | string;
interface SpatialHash {
  probes: Float64Array;
  minCellX: number;
  maxCellX: number;
  minCellY: number;
  maxCellY: number;
  cellWidth: number;
  usesPackedKeys: boolean;
  firstProbeIndexByCell: Map<SpatialCellKey, number>;
  nextProbeIndex: Int32Array;
}

const spatialHashBySnapshot = new WeakMap<
  GeometryMotionSnapshot,
  Map<number, SpatialHash>
>();

const samplePolylineByArcLength = (
  stroke: GeometryStroke,
): Float64Array => {
  const points = stroke.polyline.points;
  if (points.length === 0) {
    return new Float64Array();
  }
  if (points.length === 1) {
    return new Float64Array([points[0].x, points[0].y]);
  }

  const segments: Array<{
    start: Vec2;
    end: Vec2;
    startDistance: number;
    length: number;
  }> = [];
  let totalLength = 0;
  const segmentCount = stroke.polyline.closed ? points.length : points.length - 1;
  for (let index = 0; index < segmentCount; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!Number.isFinite(length) || length <= GEOMETRY_DISTANCE_EPSILON) {
      continue;
    }

    segments.push({ start, end, startDistance: totalLength, length });
    totalLength += length;
  }
  if (segments.length === 0) {
    return new Float64Array([points[0].x, points[0].y]);
  }

  const sampleCount = Math.max(Math.ceil((totalLength - GEOMETRY_DISTANCE_EPSILON) / PROBE_STEP_LED), 1);
  const probeCount = stroke.polyline.closed ? sampleCount : sampleCount + 1;
  const probes = new Float64Array(probeCount * 2);
  let segmentIndex = 0;
  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    if (stroke.polyline.closed && sampleIndex === sampleCount) {
      break;
    }

    const distance = totalLength * sampleIndex / sampleCount;
    while (
      segmentIndex < segments.length - 1
      && distance > segments[segmentIndex].startDistance + segments[segmentIndex].length
    ) {
      segmentIndex += 1;
    }

    const segment = segments[segmentIndex];
    const localDistance = Math.min(
      Math.max(distance - segment.startDistance, 0),
      segment.length,
    );
    const t = localDistance / segment.length;
    const probeOffset = sampleIndex * 2;
    probes[probeOffset] = segment.start.x + ((segment.end.x - segment.start.x) * t);
    probes[probeOffset + 1] = segment.start.y + ((segment.end.y - segment.start.y) * t);
  }

  return probes;
};

const buildTopologyKey = (
  strokes: ReadonlyArray<GeometryStroke>,
): string => Array.from(new Set(strokes.map((stroke) => [
  stroke.polyline.closed ? 'closed' : 'open',
  stroke.polyline.extent ?? 'bounded',
  stroke.polyline.rasterMode ?? 'stroke',
  stroke.masks.length,
].join(':')))).sort().join('|');

const buildGeometryMotionSnapshot = (
  strokes: ReadonlyArray<GeometryStroke>,
): GeometryMotionSnapshot => {
  // Visibility clipping changes what is drawn, not how far the source moved.
  // Measure source centerlines so Mask and Symmetry keep the same one-LED clock.
  const probeChunks = strokes.map((stroke) => samplePolylineByArcLength(stroke));
  const probes = concatenateProbes(probeChunks);
  return {
    probes,
    topologyKey: buildTopologyKey(strokes),
    isEmpty: probes.length === 0,
  };
};

const concatenateProbes = (chunks: ReadonlyArray<Float64Array>): Float64Array => {
  if (chunks.length <= 1) return chunks[0] ?? new Float64Array();
  const probes = new Float64Array(chunks.reduce((count, chunk) => count + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    probes.set(chunk, offset);
    offset += chunk.length;
  }
  return probes;
};

const resolveSpatialCellKey = (
  hash: Pick<
    SpatialHash,
    'minCellX' | 'maxCellX' | 'minCellY' | 'maxCellY' | 'cellWidth' | 'usesPackedKeys'
  >,
  cellX: number,
  cellY: number,
): SpatialCellKey | null => {
  if (
    cellX < hash.minCellX
    || cellX > hash.maxCellX
    || cellY < hash.minCellY
    || cellY > hash.maxCellY
  ) {
    return null;
  }

  return hash.usesPackedKeys
    ? ((cellY - hash.minCellY) * hash.cellWidth) + (cellX - hash.minCellX)
    : `${cellX},${cellY}`;
};

const buildSpatialHash = (
  probes: Float64Array,
  cellSize: number,
): SpatialHash => {
  let minCellX = Number.POSITIVE_INFINITY;
  let maxCellX = Number.NEGATIVE_INFINITY;
  let minCellY = Number.POSITIVE_INFINITY;
  let maxCellY = Number.NEGATIVE_INFINITY;
  for (let probeOffset = 0; probeOffset < probes.length; probeOffset += 2) {
    const cellX = Math.floor(probes[probeOffset] / cellSize);
    const cellY = Math.floor(probes[probeOffset + 1] / cellSize);
    minCellX = Math.min(minCellX, cellX);
    maxCellX = Math.max(maxCellX, cellX);
    minCellY = Math.min(minCellY, cellY);
    maxCellY = Math.max(maxCellY, cellY);
  }

  const cellWidth = maxCellX - minCellX + 1;
  const cellHeight = maxCellY - minCellY + 1;
  const usesPackedKeys = Number.isSafeInteger(minCellX)
    && Number.isSafeInteger(maxCellX)
    && Number.isSafeInteger(minCellY)
    && Number.isSafeInteger(maxCellY)
    && Number.isSafeInteger(cellWidth)
    && Number.isSafeInteger(cellHeight)
    && Number.isSafeInteger(cellWidth * cellHeight);
  const hash: SpatialHash = {
    probes,
    minCellX,
    maxCellX,
    minCellY,
    maxCellY,
    cellWidth,
    usesPackedKeys,
    firstProbeIndexByCell: new Map(),
    nextProbeIndex: new Int32Array(probes.length / 2),
  };
  for (let probeOffset = 0; probeOffset < probes.length; probeOffset += 2) {
    const cellX = Math.floor(probes[probeOffset] / cellSize);
    const cellY = Math.floor(probes[probeOffset + 1] / cellSize);
    const key = resolveSpatialCellKey(hash, cellX, cellY);
    if (key === null) {
      continue;
    }

    // Link cell members in one array instead of allocating an array per cell.
    const probeIndex = probeOffset / 2;
    hash.nextProbeIndex[probeIndex] = hash.firstProbeIndexByCell.get(key) ?? -1;
    hash.firstProbeIndexByCell.set(key, probeIndex);
  }
  return hash;
};

const resolveSpatialHash = (
  snapshot: GeometryMotionSnapshot,
  cellSize: number,
): SpatialHash => {
  let hashByCellSize = spatialHashBySnapshot.get(snapshot);
  if (!hashByCellSize) {
    hashByCellSize = new Map();
    spatialHashBySnapshot.set(snapshot, hashByCellSize);
  }

  const cached = hashByCellSize.get(cellSize);
  if (cached) {
    return cached;
  }

  const hash = buildSpatialHash(snapshot.probes, cellSize);
  hashByCellSize.set(cellSize, hash);
  return hash;
};

const hasProbesOutsideDistance = (
  probes: Float64Array,
  candidates: SpatialHash,
  distanceLed: number,
  requiredProbeCount: number,
): boolean => {
  const threshold = Math.max(distanceLed - GEOMETRY_DISTANCE_EPSILON, 0);
  const thresholdSquared = threshold * threshold;
  let outsideProbeCount = 0;

  for (let probeOffset = 0; probeOffset < probes.length; probeOffset += 2) {
    const probeX = probes[probeOffset];
    const probeY = probes[probeOffset + 1];
    const cellX = Math.floor(probeX / distanceLed);
    const cellY = Math.floor(probeY / distanceLed);
    let hasNearbyCandidate = false;
    for (let offsetY = -1; offsetY <= 1 && !hasNearbyCandidate; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1 && !hasNearbyCandidate; offsetX += 1) {
        const key = resolveSpatialCellKey(
          candidates,
          cellX + offsetX,
          cellY + offsetY,
        );
        if (key === null) {
          continue;
        }

        for (
          let candidateIndex = candidates.firstProbeIndexByCell.get(key) ?? -1;
          candidateIndex >= 0;
          candidateIndex = candidates.nextProbeIndex[candidateIndex]
        ) {
          const candidateOffset = candidateIndex * 2;
          const dx = candidates.probes[candidateOffset] - probeX;
          const dy = candidates.probes[candidateOffset + 1] - probeY;
          if ((dx * dx) + (dy * dy) < thresholdSquared) {
            hasNearbyCandidate = true;
            break;
          }
        }
      }
    }

    if (!hasNearbyCandidate) {
      outsideProbeCount += 1;
      if (outsideProbeCount >= requiredProbeCount) return true;
    }
  }

  return false;
};

const hasGeometryChangedByAtLeast = (
  reference: GeometryMotionSnapshot,
  candidate: GeometryMotionSnapshot,
  distanceLed = MOTION_UNIT_DISTANCE_LED,
): boolean => {
  if (reference.isEmpty !== candidate.isEmpty) {
    return true;
  }
  if (reference.isEmpty) {
    return false;
  }
  if (reference.topologyKey !== candidate.topologyKey) {
    return true;
  }

  const safeDistance = Number.isFinite(distanceLed) && distanceLed > 0
    ? distanceLed
    : MOTION_UNIT_DISTANCE_LED;
  const referenceHash = resolveSpatialHash(reference, safeDistance);
  const candidateHash = resolveSpatialHash(candidate, safeDistance);
  return hasProbesOutsideDistance(reference.probes, candidateHash, safeDistance, 1)
    || hasProbesOutsideDistance(candidate.probes, referenceHash, safeDistance, 1);
};

const hasRepresentativeMotionUnit = (
  reference: GeometryMotionSnapshot,
  candidate: GeometryMotionSnapshot,
  distanceLed: number,
): boolean => {
  // Pose retention detects ANY change; the Color unit measures the median
  // centerline displacement. A fast endpoint must not set every point's age.
  // Query the full centerline so reference-support endpoints do not introduce
  // artificial motion when the shape moves along its own tangent.
  return hasProbesOutsideDistance(
    reference.probes,
    resolveSpatialHash(candidate, distanceLed),
    distanceLed,
    Math.ceil(reference.probes.length / 4),
  ) || hasProbesOutsideDistance(
    candidate.probes,
    resolveSpatialHash(reference, distanceLed),
    distanceLed,
    Math.ceil(candidate.probes.length / 4),
  );
};

const clampFrameWindow = (
  frameWindow: FrameWindow,
  frameCount: number,
): FrameWindow => ({
  startFrame: Math.min(Math.max(Math.trunc(frameWindow.startFrame), 0), frameCount),
  endFrameExclusive: Math.min(
    Math.max(Math.trunc(frameWindow.endFrameExclusive), 0),
    frameCount,
  ),
});

const closeActiveRun = (
  state: OriginCaptureState,
  endFrameExclusive: number,
): void => {
  state.events[state.events.length - 1].endFrameExclusive = endFrameExclusive;
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index];
    if (event.runIndex !== state.runIndex) {
      break;
    }
    event.runEndFrameExclusive = endFrameExclusive;
  }
  state.activeRun = null;
};

export const extractGeometryEventTracks = (
  input: ExtractGeometryEventTracksInput,
): Map<string, GeometryStateEvent[]> => {
  const frameWindow = clampFrameWindow(input.frameWindow, input.timeline.frameCount);
  if (frameWindow.endFrameExclusive <= frameWindow.startFrame) {
    return new Map();
  }

  const stateByOriginId = new Map<string, OriginCaptureState>();
  for (const originId of input.targetOriginIds) {
    stateByOriginId.set(originId, {
      events: [],
      activeRun: null,
      runIndex: -1,
      runStartFrame: frameWindow.startFrame,
    });
  }

  for (const { frameIndex, strokes: frameStrokes } of iterateTimelineFrames(
    input.timeline, frameWindow, input.targetOriginIds,
  )) {
    const strokesByOriginId = new Map<string, GeometryStroke[]>();
    for (const stroke of frameStrokes) {
      const originId = stroke.polyline.originId;
      const strokes = strokesByOriginId.get(originId);
      if (strokes) {
        strokes.push(stroke);
      } else {
        strokesByOriginId.set(originId, [stroke]);
      }
    }

    for (const [originId, state] of stateByOriginId.entries()) {
      const strokes = strokesByOriginId.get(originId) ?? [];
      const candidate = buildGeometryMotionSnapshot(strokes);
      if (candidate.isEmpty) {
        if (state.activeRun) {
          closeActiveRun(state, frameIndex);
        }
        continue;
      }

      const activeRun = state.activeRun;
      if (!activeRun) {
        state.runIndex += 1;
        state.runStartFrame = frameIndex;
        state.events.push({
          frameIndex,
          endFrameExclusive: frameWindow.endFrameExclusive,
          runIndex: state.runIndex,
          runStartFrame: state.runStartFrame,
          runEndFrameExclusive: frameWindow.endFrameExclusive,
          motionUnitFrameCount: 0,
          strokes: [...strokes],
        });
        state.activeRun = {
          lastSample: candidate,
          motionUnitAnchor: candidate,
          movingFrameCountSinceUnit: 0,
        };
        continue;
      }

      if (!hasGeometryChangedByAtLeast(
        activeRun.lastSample,
        candidate,
        SAMPLE_MOTION_DISTANCE_LED,
      )) {
        continue;
      }

      activeRun.movingFrameCountSinceUnit += 1;
      const reachedMotionUnit = hasRepresentativeMotionUnit(
        activeRun.motionUnitAnchor,
        candidate,
        MOTION_UNIT_DISTANCE_LED,
      );
      state.events[state.events.length - 1].endFrameExclusive = frameIndex;
      state.events.push({
        frameIndex,
        endFrameExclusive: frameWindow.endFrameExclusive,
        runIndex: state.runIndex,
        runStartFrame: state.runStartFrame,
        runEndFrameExclusive: frameWindow.endFrameExclusive,
        motionUnitFrameCount: reachedMotionUnit
          ? activeRun.movingFrameCountSinceUnit
          : 0,
        strokes: [...strokes],
      });
      activeRun.lastSample = candidate;
      if (reachedMotionUnit) {
        activeRun.motionUnitAnchor = candidate;
        activeRun.movingFrameCountSinceUnit = 0;
      }
    }
  }

  const tracks = new Map<string, GeometryStateEvent[]>();
  for (const [originId, state] of stateByOriginId.entries()) {
    if (state.activeRun) {
      closeActiveRun(state, frameWindow.endFrameExclusive);
    }
    if (state.events.length > 0) {
      tracks.set(originId, state.events);
    }
  }
  return tracks;
};
