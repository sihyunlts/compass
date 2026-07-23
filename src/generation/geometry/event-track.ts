import type { Vec2 } from '../../core/core-types';
import { applyAffine } from '../../core/geometry';
import { THICKNESS } from '../../core/pipeline/constants';
import type { FrameWindow } from '../timeline';
import type { GeometryStroke, GeometryTimeline } from '../types';

export interface GeometryStateEvent {
  frameIndex: number;
  runIndex: number;
  runStartFrame: number;
  runEndFrameExclusive: number;
  // Non-zero only when this dense pose crosses the next one-LED motion unit.
  motionUnitFrameCount: number;
  strokes: ReadonlyArray<GeometryStroke>;
}

export interface GeometryMotionSnapshot {
  probes: ReadonlyArray<Vec2>;
  topologyKey: string;
  isEmpty: boolean;
}

export interface ExtractGeometryEventTracksInput {
  timeline: GeometryTimeline;
  targetOriginIds: ReadonlySet<string>;
  frameWindow: FrameWindow;
  motionUnitDistanceLed?: number;
  probeStepLed?: number;
}

interface SampledPolylinePoint extends Vec2 {
  tangentX: number;
  tangentY: number;
  isDegenerate: boolean;
  capDirection: -1 | 0 | 1;
}

interface MutableGeometryStateEvent extends GeometryStateEvent {
  runEndFrameExclusive: number;
}

interface OriginCaptureState {
  events: MutableGeometryStateEvent[];
  lastSample: GeometryMotionSnapshot | null;
  motionUnitAnchor: GeometryMotionSnapshot | null;
  movingFrameCountSinceUnit: number;
  runIndex: number;
  runStartFrame: number;
}

const DEFAULT_MOTION_UNIT_DISTANCE_LED = 1;
const DEFAULT_PROBE_STEP_LED = 0.25;
const GEOMETRY_DISTANCE_EPSILON = 1e-6;
const SAMPLE_MOTION_DISTANCE_LED = 1e-4;
const spatialHashBySnapshot = new WeakMap<
  GeometryMotionSnapshot,
  Map<number, Map<string, Vec2[]>>
>();

const isInsideMasks = (
  stroke: GeometryStroke,
  point: Vec2,
): boolean => stroke.masks.every((mask) => {
  const localPoint = applyAffine(mask.inverseTransform, point);
  return mask.contains(localPoint.x, localPoint.y);
});

const interpolateSegment = (
  start: Vec2,
  end: Vec2,
  t: number,
): SampledPolylinePoint | null => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || length <= GEOMETRY_DISTANCE_EPSILON) {
    return null;
  }

  return {
    x: start.x + (dx * t),
    y: start.y + (dy * t),
    tangentX: dx / length,
    tangentY: dy / length,
    isDegenerate: false,
    capDirection: 0,
  };
};

const samplePolylineByArcLength = (
  stroke: GeometryStroke,
  probeStepLed: number,
): SampledPolylinePoint[] => {
  const points = stroke.polyline.points;
  if (points.length === 0) {
    return [];
  }
  if (points.length === 1) {
    return [{
      x: points[0].x,
      y: points[0].y,
      tangentX: 1,
      tangentY: 0,
      isDegenerate: true,
      capDirection: 0,
    }];
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
  if (segments.length === 0 || totalLength <= GEOMETRY_DISTANCE_EPSILON) {
    return [{
      x: points[0].x,
      y: points[0].y,
      tangentX: 1,
      tangentY: 0,
      isDegenerate: true,
      capDirection: 0,
    }];
  }

  const samples: SampledPolylinePoint[] = [];
  const safeStep = Math.max(probeStepLed, GEOMETRY_DISTANCE_EPSILON);
  const sampleCount = Math.max(Math.ceil(totalLength / safeStep), 1);
  let segmentIndex = 0;
  for (let sampleIndex = 0; sampleIndex <= sampleCount; sampleIndex += 1) {
    if (stroke.polyline.closed && sampleIndex === sampleCount) {
      break;
    }

    const distance = Math.min(sampleIndex * safeStep, totalLength);
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
    const sample = interpolateSegment(
      segment.start,
      segment.end,
      localDistance / segment.length,
    );
    if (sample) {
      if (!stroke.polyline.closed && sampleIndex === 0) {
        sample.capDirection = -1;
      } else if (!stroke.polyline.closed && sampleIndex === sampleCount) {
        sample.capDirection = 1;
      }
      samples.push(sample);
    }
  }

  return samples;
};

const buildStrokeProbes = (
  stroke: GeometryStroke,
  probeStepLed: number,
): Vec2[] => {
  const centerline = samplePolylineByArcLength(stroke, probeStepLed);
  if (stroke.masks.length === 0) {
    return centerline.map(({ x, y }) => ({ x, y }));
  }

  const probes: Vec2[] = [];
  for (const sample of centerline) {
    const normalX = -sample.tangentY;
    const normalY = sample.tangentX;
    const offsets = sample.isDegenerate
      ? [{ x: 0, y: 0 }]
      : [-THICKNESS, 0, THICKNESS].map((offset) => ({
          x: normalX * offset,
          y: normalY * offset,
        }));
    if (sample.capDirection !== 0) {
      offsets.push({
        x: sample.tangentX * THICKNESS * sample.capDirection,
        y: sample.tangentY * THICKNESS * sample.capDirection,
      });
    }
    for (const offset of offsets) {
      const point = {
        x: sample.x + offset.x,
        y: sample.y + offset.y,
      };
      if (isInsideMasks(stroke, point)) {
        probes.push(point);
      }
    }
  }

  return probes;
};

const buildTopologyKey = (
  strokes: ReadonlyArray<GeometryStroke>,
): string => Array.from(new Set(strokes.map((stroke) => [
  stroke.polyline.closed ? 'closed' : 'open',
  stroke.polyline.rasterMode ?? 'stroke',
  stroke.masks.length,
  stroke.polyline.clipStack.length,
].join(':')))).sort().join('|');

export const buildGeometryMotionSnapshot = (
  strokes: ReadonlyArray<GeometryStroke>,
  probeStepLed = DEFAULT_PROBE_STEP_LED,
): GeometryMotionSnapshot => {
  // World-space probes keep capture timing invariant under fixed rigid transforms.
  const probes = strokes.flatMap((stroke) => buildStrokeProbes(stroke, probeStepLed));
  return {
    probes,
    topologyKey: buildTopologyKey(strokes),
    isEmpty: probes.length === 0,
  };
};

const toSpatialCellKey = (
  point: Vec2,
  cellSize: number,
): string => `${Math.floor(point.x / cellSize)},${Math.floor(point.y / cellSize)}`;

const buildSpatialHash = (
  probes: ReadonlyArray<Vec2>,
  cellSize: number,
): Map<string, Vec2[]> => {
  const hash = new Map<string, Vec2[]>();
  for (const probe of probes) {
    const key = toSpatialCellKey(probe, cellSize);
    const cell = hash.get(key);
    if (cell) {
      cell.push(probe);
    } else {
      hash.set(key, [probe]);
    }
  }
  return hash;
};

const resolveSpatialHash = (
  snapshot: GeometryMotionSnapshot,
  cellSize: number,
): Map<string, Vec2[]> => {
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

const hasProbeOutsideDistance = (
  probes: ReadonlyArray<Vec2>,
  candidates: ReadonlyMap<string, ReadonlyArray<Vec2>>,
  distanceLed: number,
): boolean => {
  const threshold = Math.max(distanceLed - GEOMETRY_DISTANCE_EPSILON, 0);
  const thresholdSquared = threshold * threshold;

  for (const probe of probes) {
    const cellX = Math.floor(probe.x / distanceLed);
    const cellY = Math.floor(probe.y / distanceLed);
    let hasNearbyCandidate = false;
    for (let offsetY = -1; offsetY <= 1 && !hasNearbyCandidate; offsetY += 1) {
      for (let offsetX = -1; offsetX <= 1 && !hasNearbyCandidate; offsetX += 1) {
        const cell = candidates.get(`${cellX + offsetX},${cellY + offsetY}`);
        if (!cell) {
          continue;
        }

        for (const candidate of cell) {
          const dx = candidate.x - probe.x;
          const dy = candidate.y - probe.y;
          if ((dx * dx) + (dy * dy) < thresholdSquared) {
            hasNearbyCandidate = true;
            break;
          }
        }
      }
    }

    if (!hasNearbyCandidate) {
      return true;
    }
  }

  return false;
};

export const hasGeometryChangedByAtLeast = (
  reference: GeometryMotionSnapshot,
  candidate: GeometryMotionSnapshot,
  distanceLed = DEFAULT_MOTION_UNIT_DISTANCE_LED,
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
    : DEFAULT_MOTION_UNIT_DISTANCE_LED;
  const referenceHash = resolveSpatialHash(reference, safeDistance);
  const candidateHash = resolveSpatialHash(candidate, safeDistance);
  return hasProbeOutsideDistance(reference.probes, candidateHash, safeDistance)
    || hasProbeOutsideDistance(candidate.probes, referenceHash, safeDistance);
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
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index];
    if (event.runIndex !== state.runIndex) {
      break;
    }
    event.runEndFrameExclusive = endFrameExclusive;
  }
  state.lastSample = null;
  state.motionUnitAnchor = null;
  state.movingFrameCountSinceUnit = 0;
};

export const extractGeometryEventTracks = (
  input: ExtractGeometryEventTracksInput,
): Map<string, GeometryStateEvent[]> => {
  const frameWindow = clampFrameWindow(input.frameWindow, input.timeline.frames.length);
  if (frameWindow.endFrameExclusive <= frameWindow.startFrame) {
    return new Map();
  }

  const motionUnitDistanceLed = Number.isFinite(input.motionUnitDistanceLed)
    && (input.motionUnitDistanceLed ?? 0) > 0
    ? input.motionUnitDistanceLed as number
    : DEFAULT_MOTION_UNIT_DISTANCE_LED;
  const probeStepLed = Number.isFinite(input.probeStepLed)
    && (input.probeStepLed ?? 0) > 0
    ? input.probeStepLed as number
    : DEFAULT_PROBE_STEP_LED;
  const stateByOriginId = new Map<string, OriginCaptureState>();
  for (const originId of input.targetOriginIds) {
    stateByOriginId.set(originId, {
      events: [],
      lastSample: null,
      motionUnitAnchor: null,
      movingFrameCountSinceUnit: 0,
      runIndex: -1,
      runStartFrame: frameWindow.startFrame,
    });
  }

  for (
    let frameIndex = frameWindow.startFrame;
    frameIndex < frameWindow.endFrameExclusive;
    frameIndex += 1
  ) {
    const strokesByOriginId = new Map<string, GeometryStroke[]>();
    for (const stroke of input.timeline.frames[frameIndex]?.strokes ?? []) {
      const originId = stroke.polyline.originId;
      if (!input.targetOriginIds.has(originId)) {
        continue;
      }
      const strokes = strokesByOriginId.get(originId);
      if (strokes) {
        strokes.push(stroke);
      } else {
        strokesByOriginId.set(originId, [stroke]);
      }
    }

    for (const [originId, state] of stateByOriginId.entries()) {
      const strokes = strokesByOriginId.get(originId) ?? [];
      const candidate = buildGeometryMotionSnapshot(strokes, probeStepLed);
      if (candidate.isEmpty) {
        if (state.lastSample) {
          closeActiveRun(state, frameIndex);
        }
        continue;
      }

      if (!state.lastSample) {
        state.runIndex += 1;
        state.runStartFrame = frameIndex;
        state.events.push({
          frameIndex,
          runIndex: state.runIndex,
          runStartFrame: state.runStartFrame,
          runEndFrameExclusive: frameWindow.endFrameExclusive,
          motionUnitFrameCount: 0,
          strokes: [...strokes],
        });
        state.lastSample = candidate;
        state.motionUnitAnchor = candidate;
        continue;
      }

      if (!hasGeometryChangedByAtLeast(
        state.lastSample,
        candidate,
        SAMPLE_MOTION_DISTANCE_LED,
      )) {
        continue;
      }

      state.movingFrameCountSinceUnit += 1;
      const reachedMotionUnit = state.motionUnitAnchor === null
        || hasGeometryChangedByAtLeast(
          state.motionUnitAnchor,
          candidate,
          motionUnitDistanceLed,
        );
      state.events.push({
        frameIndex,
        runIndex: state.runIndex,
        runStartFrame: state.runStartFrame,
        runEndFrameExclusive: frameWindow.endFrameExclusive,
        motionUnitFrameCount: reachedMotionUnit
          ? Math.max(state.movingFrameCountSinceUnit, 1)
          : 0,
        strokes: [...strokes],
      });
      state.lastSample = candidate;
      if (reachedMotionUnit) {
        state.motionUnitAnchor = candidate;
        state.movingFrameCountSinceUnit = 0;
      }
    }
  }

  const tracks = new Map<string, GeometryStateEvent[]>();
  for (const [originId, state] of stateByOriginId.entries()) {
    if (state.lastSample) {
      closeActiveRun(state, frameWindow.endFrameExclusive);
    }
    if (state.events.length > 0) {
      tracks.set(originId, state.events);
    }
  }
  return tracks;
};
