import {
  composeAffine,
  COMPOSITION_CENTER,
  applyTransformToPolyline,
  invertAffine,
  toAxisMirrorTransformAt,
  toMirrorTransformAt,
  toRotateTransformAt,
  toScaleTransformAt,
  toTranslationTransform,
} from '../core/geometry';
import {
  applyModulationProgramToChain,
  compileModulationProgram,
  type CompiledModulationProgram,
} from '../core/modulation/compiled-program';
import { resolveMutedSources } from '../core/pipeline/groups';
import type {
  SceneTemporalState,
  TemporalAffineRemap,
  TemporalRemap,
} from '../core/core-types';
import {
  cloneSceneTemporalState,
  composeSceneTemporalState,
  createIdentitySceneTemporalState,
  evaluateTemporalRemap,
  type TemporalTransform,
} from '../core/scene-operators/temporal';
import { createSampledRemapFromTimeWarpCurve, isIdentityTimeWarpCurve } from '../core/timewarp/curve';
import {
  buildColorConfig,
  planColorProgramSlots,
  type PlannedColorSlot,
  type TimedColorSource,
} from '../devices/color/color-program';
import { doesDeviceToggleTimelineParity } from '../devices/timeline-parity';
import { isDeviceEffectivelyEnabled } from '../shared/group-state';
import { cloneDeviceNode } from '../shared/model';
import type {
  ColorEffectNode,
  GeneratorChain,
  GeneratorDeviceNode,
  GeneratorEffectNode,
  GeneratorNode,
  MaskEffectNode,
  StretchEffectNode,
  SymmetryEffectNode,
  TimeWarpEffectNode,
  TrimEffectNode,
} from '../shared/model';
import { normalizeOptionalId } from '../shared/normalize-id';
import { rasterizeGeneratorFrame } from './raster';
import { buildCanonicalExecutionPlan } from './analysis/execution-plan';
import { buildCompiledRackPlan } from './plan/compile';
import type { CompiledRackPlan, CompiledRackStage } from './plan/types';
import type {
  BeatRange,
  CanonicalExecutionRequest,
  OperatorExecutionPlan,
  SpatialRequirement,
} from './analysis/types';
import {
  collectActivationSegments,
  collectOccupiedCoordinates,
  createCoordinateMask,
  type GeometryActivationSegment,
} from './timeline-analysis';
import {
  addExistingStrokeToFrame,
  addStrokeToFrame,
  beginTimelineStage,
  completeTimelineStage,
  createEmptyTimeline,
  createIdentityMask,
  ensureTimelineFrameCount,
  finalizeTimeline,
  setFrameStrokes,
  toFrameCount,
  toFrameWindow,
  type FrameWindow,
} from './timeline';
import type {
  CanonicalFieldResult,
  CanonicalOutputAdapter,
  GeometryMask,
  GeometryStroke,
  GeometryTimeline,
  GenerationOriginTimelineState,
  GenerationTimelineWindow,
} from './types';

type TimelineWindow = GenerationTimelineWindow;
type OriginTimelineState = GenerationOriginTimelineState;

interface MutableGenerationState {
  timeline: GeometryTimeline;
  timelineStateByOriginId: Map<string, OriginTimelineState>;
  pendingTemporalWriteOrderByOriginId: Map<string, number>;
}

interface ModulationContext {
  loopLengthBeats: number;
  program: CompiledModulationProgram;
  deviceByFrameKey: Map<string, GeneratorDeviceNode>;
}

interface OriginFrameRemap {
  nextTemporal: SceneTemporalState;
  sourceFrameIndexByOutputFrame: ReadonlyArray<number | null>;
  writeOrder: number;
}

const DEFAULT_TIMELINE_WINDOW: TimelineWindow = Object.freeze({
  start: 0,
  end: 1,
});

const EMPTY_TIMELINE_WINDOW: TimelineWindow = Object.freeze({
  start: 0,
  end: 0,
});

const FIXED_TIMELINE_END_BEAT = DEFAULT_TIMELINE_WINDOW.end;
const TIMELINE_WINDOW_EPSILON = 1e-9;

const FULL_EXECUTION_BOUNDS: SpatialRequirement = 'all';
const EMPTY_EXECUTION_PLAN: OperatorExecutionPlan = Object.freeze({
  requiredOutputBounds: FULL_EXECUTION_BOUNDS,
  requiredInputRoi: FULL_EXECUTION_BOUNDS,
  requiredSourceRoi: 'none',
  requiredFrameWindow: 'all',
  requiredSourceFrameWindow: 'none',
});

const resolveDeviceExecutionPlan = (
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
  deviceId: string,
): OperatorExecutionPlan => executionPlanByDeviceId.get(deviceId) ?? EMPTY_EXECUTION_PLAN;

const resolveFrameWindow = (
  requirement: BeatRange | 'all' | 'none',
  sampleStepBeats: number,
  frameCount: number,
): FrameWindow => {
  if (requirement === 'all') {
    return {
      startFrame: 0,
      endFrameExclusive: frameCount,
    };
  }

  if (requirement === 'none') {
    return {
      startFrame: 0,
      endFrameExclusive: 0,
    };
  }

  return toFrameWindow(requirement, sampleStepBeats, frameCount);
};

const isFrameWithinWindow = (
  frameIndex: number,
  window: FrameWindow,
): boolean => frameIndex >= window.startFrame && frameIndex < window.endFrameExclusive;

const cloneTimelineStateByOriginId = (
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
): Map<string, OriginTimelineState> => new Map(
  Array.from(timelineStateByOriginId.entries(), ([originId, timelineState]) => [
    originId,
    {
      observedWindow: {
        start: timelineState.observedWindow.start,
        end: timelineState.observedWindow.end,
      },
      temporal: cloneSceneTemporalState(timelineState.temporal),
    },
  ]),
);

const clonePendingTemporalWriteOrderByOriginId = (
  pendingTemporalWriteOrderByOriginId: ReadonlyMap<string, number>,
): Map<string, number> => new Map(pendingTemporalWriteOrderByOriginId);

const cloneTimelineWindow = (
  window: TimelineWindow,
): TimelineWindow => ({
  start: window.start,
  end: window.end,
});

const isWindowEmpty = (
  window: TimelineWindow | null,
): boolean => !window || window.end <= window.start + TIMELINE_WINDOW_EPSILON;

const isIdentityTemporalRemap = (
  remap: TemporalRemap,
): boolean => remap.kind === 'affine'
  && Math.abs(remap.alpha - 1) <= TIMELINE_WINDOW_EPSILON
  && Math.abs(remap.beta) <= TIMELINE_WINDOW_EPSILON;

const hasPendingTemporalState = (
  timelineState: OriginTimelineState,
): boolean => timelineState.temporal.hasAuthoredTimeline || !isIdentityTemporalRemap(timelineState.temporal.remap);

const clampTimelineWindowToFixedLoop = (
  window: TimelineWindow,
): TimelineWindow => ({
  start: Math.max(window.start, DEFAULT_TIMELINE_WINDOW.start),
  end: Math.min(window.end, FIXED_TIMELINE_END_BEAT),
});

const isFixedTimelineWindow = (
  window: TimelineWindow,
): boolean => Math.abs(window.start - DEFAULT_TIMELINE_WINDOW.start) <= TIMELINE_WINDOW_EPSILON
  && Math.abs(window.end - FIXED_TIMELINE_END_BEAT) <= TIMELINE_WINDOW_EPSILON;

const createAffineTemporalRemap = (
  alpha: number,
  beta: number,
): TemporalAffineRemap => ({
  kind: 'affine',
  alpha,
  beta,
});

const createSampledPlacementRemap = (
  placementWindow: TimelineWindow,
  remap: TemporalRemap,
): TemporalRemap => {
  if (remap.kind === 'affine') {
    const placementSpan = placementWindow.end - placementWindow.start;
    return createAffineTemporalRemap(
      remap.alpha,
      placementWindow.start + placementSpan * remap.beta - placementWindow.start * remap.alpha,
    );
  }

  const placementSpan = placementWindow.end - placementWindow.start;
  return {
    kind: 'sampled',
    domainStart: placementWindow.start,
    domainEnd: placementWindow.end,
    samples: remap.samples.map((sample) => (
      sample === null ? null : placementWindow.start + placementSpan * sample
    )),
  };
};

const resolvePlacementWindow = (
  timelineState: OriginTimelineState | undefined,
): TimelineWindow => cloneTimelineWindow(timelineState?.temporal.visibilityWindow ?? DEFAULT_TIMELINE_WINDOW);

const resolveSemanticSourceWindow = (
  timelineState: OriginTimelineState | undefined,
): TimelineWindow | null => {
  if (!timelineState) {
    return null;
  }

  if (timelineState.temporal.hasAuthoredTimeline) {
    return cloneTimelineWindow(DEFAULT_TIMELINE_WINDOW);
  }

  return timelineState.observedWindow.end > timelineState.observedWindow.start
    ? cloneTimelineWindow(timelineState.observedWindow)
    : cloneTimelineWindow(timelineState.temporal.visibilityWindow);
};

const buildStretchTransform = (
  sourceWindow: TimelineWindow,
  start: number,
  end: number,
): TemporalTransform => {
  const sourceSpan = sourceWindow.end - sourceWindow.start;

  return {
    remapToInput: createAffineTemporalRemap(
      sourceSpan / (end - start),
      sourceWindow.start - (sourceSpan * start) / (end - start),
    ),
    visibilityWindow: { start, end },
    marksAuthoredTimeline: true,
  };
};

const buildNormalizedTrimTransform = (
  sourceWindow: TimelineWindow,
  start: number,
  end: number,
): TemporalTransform => {
  const sourceSpan = sourceWindow.end - sourceWindow.start;

  return {
    remapToInput: createAffineTemporalRemap(
      sourceSpan * (end - start),
      sourceWindow.start + sourceSpan * start,
    ),
    visibilityWindow: cloneTimelineWindow(DEFAULT_TIMELINE_WINDOW),
    marksAuthoredTimeline: true,
  };
};

const buildPlacementPreservingReverseTransform = (
  placementWindow: TimelineWindow,
): TemporalTransform => ({
  remapToInput: createAffineTemporalRemap(
    -1,
    placementWindow.start + placementWindow.end,
  ),
  visibilityWindow: cloneTimelineWindow(placementWindow),
});

const buildPlacementPreservingTimeWarpTransform = (
  placementWindow: TimelineWindow,
  remap: TemporalRemap,
): TemporalTransform => ({
  remapToInput: createSampledPlacementRemap(placementWindow, remap),
  visibilityWindow: cloneTimelineWindow(placementWindow),
});

const clampSceneTemporalStateToFixedLoop = (
  sceneTemporal: SceneTemporalState,
): SceneTemporalState => ({
  ...cloneSceneTemporalState(sceneTemporal),
  visibilityWindow: clampTimelineWindowToFixedLoop(sceneTemporal.visibilityWindow),
});

const createMaterializedTemporalState = (
  visibilityWindow: TimelineWindow,
): SceneTemporalState => ({
  remap: createAffineTemporalRemap(1, 0),
  visibilityWindow: cloneTimelineWindow(visibilityWindow),
  hasAuthoredTimeline: false,
});

const createModulationContext = (
  modulationChain: GeneratorChain,
  loopLengthBeats: number,
): ModulationContext => ({
  loopLengthBeats,
  program: compileModulationProgram(modulationChain),
  deviceByFrameKey: new Map<string, GeneratorDeviceNode>(),
});

const resolveModulatedDeviceAtFrame = <T extends GeneratorDeviceNode>(
  context: ModulationContext,
  device: T,
  frameIndex: number,
  sampleStepBeats: number,
): T => {
  if (context.program.routes.length === 0) {
    return device;
  }

  const cacheKey = `${device.id}:${frameIndex}`;
  const cached = context.deviceByFrameKey.get(cacheKey);
  if (cached) {
    return cached as T;
  }

  const snapshot = cloneDeviceNode(device) as T;
  applyModulationProgramToChain(
    context.program,
    {
      devices: [snapshot],
      groupStateById: {},
    },
    new Map<string, GeneratorDeviceNode>([[snapshot.id, snapshot]]),
    frameIndex * sampleStepBeats,
    context.loopLengthBeats,
    { wrap: true },
  );
  context.deviceByFrameKey.set(cacheKey, snapshot);
  return snapshot;
};

const isTargetedStroke = (
  stroke: GeometryStroke,
  targetGroupId: string | null,
): boolean => targetGroupId === null || stroke.originGroupId === targetGroupId;

const splitFrameStrokesByTarget = (
  strokes: ReadonlyArray<GeometryStroke>,
  targetGroupId: string | null,
): {
  targeted: GeometryStroke[];
  untargeted: GeometryStroke[];
} => {
  const targeted: GeometryStroke[] = [];
  const untargeted: GeometryStroke[] = [];

  for (const stroke of strokes) {
    if (isTargetedStroke(stroke, targetGroupId)) {
      targeted.push(stroke);
    } else {
      untargeted.push(stroke);
    }
  }

  return {
    targeted,
    untargeted,
  };
};

const takeTargetedStrokesFromFrame = (
  timeline: GeometryTimeline,
  frameIndex: number,
  targetGroupId: string | null,
): GeometryStroke[] => {
  const { targeted, untargeted } = splitFrameStrokesByTarget(
    timeline.frames[frameIndex]?.strokes ?? [],
    targetGroupId,
  );

  if (targeted.length > 0) {
    setFrameStrokes(timeline, frameIndex, untargeted);
  }

  return targeted;
};

const forEachTargetedFrame = (
  timeline: GeometryTimeline,
  sourceFrameCount: number,
  targetGroupId: string | null,
  frameWindow: FrameWindow,
  visit: (frameIndex: number, targeted: ReadonlyArray<GeometryStroke>) => void,
): void => {
  for (let frameIndex = 0; frameIndex < sourceFrameCount; frameIndex += 1) {
    const targeted = takeTargetedStrokesFromFrame(timeline, frameIndex, targetGroupId);
    if (targeted.length === 0 || !isFrameWithinWindow(frameIndex, frameWindow)) {
      continue;
    }

    visit(frameIndex, targeted);
  }
};

const stripTargetedFrames = (
  timeline: GeometryTimeline,
  sourceFrameCount: number,
  targetGroupId: string | null,
): void => {
  for (let frameIndex = 0; frameIndex < sourceFrameCount; frameIndex += 1) {
    takeTargetedStrokesFromFrame(timeline, frameIndex, targetGroupId);
  }
};

const buildTargetOriginIds = (
  timeline: GeometryTimeline,
  targetGroupId: string | null,
): Set<string> => {
  const originIds = new Set<string>();

  for (const frame of timeline.frames) {
    for (const stroke of frame.strokes) {
      if (isTargetedStroke(stroke, targetGroupId)) {
        originIds.add(stroke.polyline.originId);
      }
    }
  }

  return originIds;
};

const resolveSourceWindow = (
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  originId: string,
): TimelineWindow | null => resolveSemanticSourceWindow(timelineStateByOriginId.get(originId));

const resolveOutputWindow = (
  timelineState: OriginTimelineState | undefined,
): TimelineWindow => resolvePlacementWindow(timelineState);

const buildTimelineStateMap = (
  originIds: Iterable<string>,
  observedWindowByOriginId: ReadonlyMap<string, TimelineWindow>,
  resolveTemporalState: (originId: string, observedWindow: TimelineWindow) => SceneTemporalState,
): Map<string, OriginTimelineState> => {
  const timelineStateByOriginId = new Map<string, OriginTimelineState>();

  for (const originId of originIds) {
    const observedWindow = cloneTimelineWindow(
      observedWindowByOriginId.get(originId) ?? EMPTY_TIMELINE_WINDOW,
    );
    timelineStateByOriginId.set(originId, {
      observedWindow,
      temporal: resolveTemporalState(originId, observedWindow),
    });
  }

  return timelineStateByOriginId;
};

const buildTimelineStateByOriginId = (
  timeline: GeometryTimeline,
  previousTimelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
  temporalOverrides: ReadonlyMap<string, SceneTemporalState> = new Map(),
): Map<string, OriginTimelineState> => {
  const observedWindowByOriginId = outputAdapter.buildVisibleWindowByOriginId(
    timeline,
    mutedGroupIds,
    mutedGeneratorIds,
  );
  const originIds = new Set<string>([
    ...previousTimelineStateByOriginId.keys(),
    ...observedWindowByOriginId.keys(),
    ...temporalOverrides.keys(),
  ]);

  return buildTimelineStateMap(
    originIds,
    observedWindowByOriginId,
    (originId) => {
      const previous = previousTimelineStateByOriginId.get(originId);
      return temporalOverrides.has(originId)
        ? cloneSceneTemporalState(temporalOverrides.get(originId) ?? createIdentitySceneTemporalState())
        : cloneSceneTemporalState(previous?.temporal ?? createIdentitySceneTemporalState());
    },
  );
};

const cloneMask = (
  mask: GeometryMask,
): GeometryMask => ({
  contains: mask.contains,
  inverseTransform: { ...mask.inverseTransform },
});

const transformMask = (
  mask: GeometryMask,
  transform: ReturnType<typeof toTranslationTransform> | null,
): GeometryMask => {
  if (!transform) {
    return cloneMask(mask);
  }

  const inverse = invertAffine(transform);
  if (!inverse) {
    return cloneMask(mask);
  }

  return {
    contains: mask.contains,
    inverseTransform: composeAffine(mask.inverseTransform, inverse),
  };
};

const cloneStrokeWithWriteOrder = (
  stroke: GeometryStroke,
  writeOrder: number,
): Omit<GeometryStroke, 'writeId'> => ({
  polyline: {
    ...stroke.polyline,
    points: stroke.polyline.points.map((point) => ({ ...point })),
    clipStack: stroke.polyline.clipStack.map((clip) => ({
      ...clip,
      inverseTransform: { ...clip.inverseTransform },
    })),
  },
  originGroupId: stroke.originGroupId,
  writeOrder,
  masks: stroke.masks.map(cloneMask),
});

const cloneStrokeWithVelocityAndWriteOrder = (
  stroke: GeometryStroke,
  velocity: number,
  writeOrder: number,
): Omit<GeometryStroke, 'writeId'> => ({
  polyline: {
    ...stroke.polyline,
    velocity,
    points: stroke.polyline.points.map((point) => ({ ...point })),
    clipStack: stroke.polyline.clipStack.map((clip) => ({
      ...clip,
      inverseTransform: { ...clip.inverseTransform },
    })),
  },
  originGroupId: stroke.originGroupId,
  writeOrder,
  masks: stroke.masks.map(cloneMask),
});

const transformStroke = (
  stroke: GeometryStroke,
  transform: ReturnType<typeof toTranslationTransform> | null,
  writeOrder: number,
): Omit<GeometryStroke, 'writeId'> => ({
  polyline: transform
    ? applyTransformToPolyline(stroke.polyline, transform)
    : {
        ...stroke.polyline,
        points: stroke.polyline.points.map((point) => ({ ...point })),
        clipStack: stroke.polyline.clipStack.map((clip) => ({
          ...clip,
          inverseTransform: { ...clip.inverseTransform },
        })),
      },
  originGroupId: stroke.originGroupId,
  writeOrder,
  masks: stroke.masks.map((mask) => transformMask(mask, transform)),
});

const applySpatialTransform = (
  state: MutableGenerationState,
  targetGroupId: string | null,
  writeOrder: number,
  resolveTransformAtFrame: (frameIndex: number) => ReturnType<typeof toTranslationTransform> | null,
  requiredFrameWindow: BeatRange | 'all',
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const nextTimeline = beginTimelineStage(state.timeline);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    state.timeline.frames.length,
  );

  forEachTargetedFrame(nextTimeline, state.timeline.frames.length, targetGroupId, frameWindow, (frameIndex, targeted) => {
    const transform = resolveTransformAtFrame(frameIndex);
    for (const stroke of targeted) {
      addStrokeToFrame(nextTimeline, frameIndex, transformStroke(stroke, transform, writeOrder));
    }
  });

  const sealedTimeline = completeTimelineStage(nextTimeline);
  return {
    timeline: sealedTimeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      sealedTimeline,
      state.timelineStateByOriginId,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    pendingTemporalWriteOrderByOriginId: clonePendingTemporalWriteOrderByOriginId(
      state.pendingTemporalWriteOrderByOriginId,
    ),
  };
};

const isWithinHalfBoundary = (
  coordinate: number,
  boundary: number,
  keepMin: boolean,
): boolean => keepMin ? coordinate <= boundary : coordinate >= boundary;

const isInQuadrant = (
  x: number,
  y: number,
  anchor: SymmetryEffectNode['params']['sourceAnchor'],
): boolean => {
  const keepMinX = anchor === 'bl' || anchor === 'tl';
  const keepMinY = anchor === 'bl' || anchor === 'br';
  return isWithinHalfBoundary(x, COMPOSITION_CENTER.x, keepMinX)
    && isWithinHalfBoundary(y, COMPOSITION_CENTER.y, keepMinY);
};

const applyMirrorHalfSymmetry = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const nextTimeline = beginTimelineStage(state.timeline);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    state.timeline.frames.length,
  );

  const keepMin = effect.params.axis === 'horizontal'
    ? effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'tl'
    : effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'br';
  const mirrorTransform = toAxisMirrorTransformAt(effect.params.axis, COMPOSITION_CENTER);
  const boundary = effect.params.axis === 'horizontal' ? COMPOSITION_CENTER.x : COMPOSITION_CENTER.y;

  forEachTargetedFrame(nextTimeline, state.timeline.frames.length, targetGroupId, frameWindow, (frameIndex, targeted) => {
    for (const stroke of targeted) {
      const sourceHalfMask = createIdentityMask((x, y) => isWithinHalfBoundary(
        effect.params.axis === 'horizontal' ? x : y,
        boundary,
        keepMin,
      ));
      addStrokeToFrame(nextTimeline, frameIndex, {
        ...cloneStrokeWithWriteOrder(stroke, writeOrder),
        masks: [...stroke.masks.map(cloneMask), sourceHalfMask],
      });

      const mirroredHalfMask = createIdentityMask((x, y) => isWithinHalfBoundary(
        effect.params.axis === 'horizontal' ? x : y,
        boundary,
        !keepMin,
      ));
      const mirroredStroke = transformStroke(stroke, mirrorTransform, writeOrder);
      addStrokeToFrame(nextTimeline, frameIndex, {
        ...mirroredStroke,
        masks: [...mirroredStroke.masks, mirroredHalfMask],
      });
    }
  });

  const sealedTimeline = completeTimelineStage(nextTimeline);
  return {
    timeline: sealedTimeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      sealedTimeline,
      state.timelineStateByOriginId,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    pendingTemporalWriteOrderByOriginId: clonePendingTemporalWriteOrderByOriginId(
      state.pendingTemporalWriteOrderByOriginId,
    ),
  };
};

const applyQuadMirrorSymmetry = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const nextTimeline = beginTimelineStage(state.timeline);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    state.timeline.frames.length,
  );

  const quadrants: ReadonlyArray<SymmetryEffectNode['params']['sourceAnchor']> = ['bl', 'br', 'tr', 'tl'];
  const sourceKeepMinX = effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'tl';
  const sourceKeepMinY = effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'br';

  forEachTargetedFrame(nextTimeline, state.timeline.frames.length, targetGroupId, frameWindow, (frameIndex, targeted) => {
    for (const stroke of targeted) {
      for (const quadrant of quadrants) {
        const targetKeepMinX = quadrant === 'bl' || quadrant === 'tl';
        const targetKeepMinY = quadrant === 'bl' || quadrant === 'br';

        let transform = null as ReturnType<typeof toTranslationTransform> | null;
        if (sourceKeepMinX !== targetKeepMinX) {
          transform = toAxisMirrorTransformAt('horizontal', COMPOSITION_CENTER);
        }
        if (sourceKeepMinY !== targetKeepMinY) {
          const verticalTransform = toAxisMirrorTransformAt('vertical', COMPOSITION_CENTER);
          transform = transform
            ? composeAffine(verticalTransform, transform)
            : verticalTransform;
        }

        const quadrantMask = createIdentityMask((x, y) => isInQuadrant(x, y, quadrant));
        const transformedStroke = transformStroke(stroke, transform, writeOrder);
        addStrokeToFrame(nextTimeline, frameIndex, {
          ...transformedStroke,
          masks: [...transformedStroke.masks, quadrantMask],
        });
      }
    }
  });

  const sealedTimeline = completeTimelineStage(nextTimeline);
  return {
    timeline: sealedTimeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      sealedTimeline,
      state.timelineStateByOriginId,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    pendingTemporalWriteOrderByOriginId: clonePendingTemporalWriteOrderByOriginId(
      state.pendingTemporalWriteOrderByOriginId,
    ),
  };
};

const applyQuadPinwheelSymmetry = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const nextTimeline = beginTimelineStage(state.timeline);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    state.timeline.frames.length,
  );

  const quadrants: ReadonlyArray<SymmetryEffectNode['params']['sourceAnchor']> = ['bl', 'br', 'tr', 'tl'];
  const sourceIndex = quadrants.findIndex((quadrant) => quadrant === effect.params.sourceAnchor);

  forEachTargetedFrame(nextTimeline, state.timeline.frames.length, targetGroupId, frameWindow, (frameIndex, targeted) => {
    for (const stroke of targeted) {
      for (let targetIndex = 0; targetIndex < quadrants.length; targetIndex += 1) {
        const quadrant = quadrants[targetIndex];
        const delta = (targetIndex - sourceIndex + quadrants.length) % quadrants.length;
        const angleDeg = delta * 90;
        const transform = angleDeg === 0 ? null : toRotateTransformAt(angleDeg, COMPOSITION_CENTER);
        const quadrantMask = createIdentityMask((x, y) => isInQuadrant(x, y, quadrant));
        const transformedStroke = transformStroke(stroke, transform, writeOrder);
        addStrokeToFrame(nextTimeline, frameIndex, {
          ...transformedStroke,
          masks: [...transformedStroke.masks, quadrantMask],
        });
      }
    }
  });

  const sealedTimeline = completeTimelineStage(nextTimeline);
  return {
    timeline: sealedTimeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      sealedTimeline,
      state.timelineStateByOriginId,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    pendingTemporalWriteOrderByOriginId: clonePendingTemporalWriteOrderByOriginId(
      state.pendingTemporalWriteOrderByOriginId,
    ),
  };
};

const applySymmetryEffect = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  if (effect.params.mode === 'mirror-half') {
    return applyMirrorHalfSymmetry(
      state,
      effect,
      targetGroupId,
      writeOrder,
      requiredFrameWindow,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    );
  }

  if (effect.params.mode === 'quad-mirror') {
    return applyQuadMirrorSymmetry(
      state,
      effect,
      targetGroupId,
      writeOrder,
      requiredFrameWindow,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    );
  }

  return applyQuadPinwheelSymmetry(
    state,
    effect,
    targetGroupId,
    writeOrder,
    requiredFrameWindow,
    outputAdapter,
    mutedGroupIds,
    mutedGeneratorIds,
  );
};

const buildSourceStrokesByOriginAndFrame = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
): Map<string, Map<number, GeometryStroke[]>> => {
  const strokesByOriginId = new Map<string, Map<number, GeometryStroke[]>>();

  for (let frameIndex = 0; frameIndex < timeline.frames.length; frameIndex += 1) {
    for (const stroke of timeline.frames[frameIndex].strokes) {
      if (!targetOriginIds.has(stroke.polyline.originId)) {
        continue;
      }

      let frameMap = strokesByOriginId.get(stroke.polyline.originId);
      if (!frameMap) {
        frameMap = new Map<number, GeometryStroke[]>();
        strokesByOriginId.set(stroke.polyline.originId, frameMap);
      }

      let frameStrokes = frameMap.get(frameIndex);
      if (!frameStrokes) {
        frameStrokes = [];
        frameMap.set(frameIndex, frameStrokes);
      }

      frameStrokes.push(stroke);
    }
  }

  return strokesByOriginId;
};

const splitFrameStrokesByOriginIds = (
  strokes: ReadonlyArray<GeometryStroke>,
  targetOriginIds: ReadonlySet<string>,
): {
  targeted: GeometryStroke[];
  untargeted: GeometryStroke[];
} => {
  const targeted: GeometryStroke[] = [];
  const untargeted: GeometryStroke[] = [];

  for (const stroke of strokes) {
    if (targetOriginIds.has(stroke.polyline.originId)) {
      targeted.push(stroke);
    } else {
      untargeted.push(stroke);
    }
  }

  return { targeted, untargeted };
};

const takeOriginStrokesFromFrame = (
  timeline: GeometryTimeline,
  frameIndex: number,
  targetOriginIds: ReadonlySet<string>,
): GeometryStroke[] => {
  const { targeted, untargeted } = splitFrameStrokesByOriginIds(
    timeline.frames[frameIndex]?.strokes ?? [],
    targetOriginIds,
  );

  if (targeted.length > 0) {
    setFrameStrokes(timeline, frameIndex, untargeted);
  }

  return targeted;
};

const stripOriginFrames = (
  timeline: GeometryTimeline,
  sourceFrameCount: number,
  targetOriginIds: ReadonlySet<string>,
): void => {
  for (let frameIndex = 0; frameIndex < sourceFrameCount; frameIndex += 1) {
    takeOriginStrokesFromFrame(timeline, frameIndex, targetOriginIds);
  }
};

const toSourceFrameIndex = (
  beat: number,
  timeline: GeometryTimeline,
): number => {
  const frameCount = Math.max(timeline.frames.length, 1);
  return Math.min(
    Math.max(Math.floor(beat / timeline.sampleStepBeats), 0),
    frameCount - 1,
  );
};

const resolveColorSlotSourceEndBeat = <T extends TimedColorSource>(
  slot: PlannedColorSlot<T>,
): number => {
  const slotDuration = slot.endBeat - slot.startBeat;
  if (!Number.isFinite(slotDuration) || slotDuration <= 0) {
    return slot.source.startBeat;
  }

  return Math.min(slot.source.endBeat, slot.source.startBeat + slotDuration);
};

const resolveColorSlotSourceFrameWindow = <T extends TimedColorSource>(
  slot: PlannedColorSlot<T>,
  timeline: GeometryTimeline,
): FrameWindow => toFrameWindow(
  {
    start: slot.source.startBeat,
    end: resolveColorSlotSourceEndBeat(slot),
  },
  timeline.sampleStepBeats,
  timeline.frames.length,
);

const resolveColorSlotDestinationFrameWindow = <T extends TimedColorSource>(
  slot: PlannedColorSlot<T>,
  timeline: GeometryTimeline,
): FrameWindow => toFrameWindow(
  {
    start: slot.startBeat,
    end: slot.endBeat,
  },
  timeline.sampleStepBeats,
  timeline.frames.length,
);

const resolveColorDestinationFrameIndex = (
  sourceFrameIndex: number,
  slotOffset: number,
  sampleStepBeats: number,
): number => Math.floor(
  ((sourceFrameIndex * sampleStepBeats) + slotOffset) / sampleStepBeats,
);

const hasMappedSourceFrame = (
  sourceFrameIndexByOutputFrame: ReadonlyArray<number | null>,
): boolean => sourceFrameIndexByOutputFrame.some((frameIndex) => frameIndex !== null);

const remapTimeline = (
  state: MutableGenerationState,
  remaps: ReadonlyMap<string, OriginFrameRemap>,
  requiredFrameWindow: BeatRange | 'all',
  outputEndBeat: number,
  preserveWriteMetadata: boolean,
): GeometryTimeline => {
  const targetOriginIds = new Set(remaps.keys());
  const nextTimeline = beginTimelineStage(state.timeline, outputEndBeat);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    nextTimeline.frames.length,
  );

  stripOriginFrames(
    nextTimeline,
    Math.min(state.timeline.frames.length, nextTimeline.frames.length),
    targetOriginIds,
  );

  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    state.timeline,
    targetOriginIds,
  );
  for (const [originId, remap] of remaps.entries()) {
    const sourceStrokesByFrame = sourceStrokesByOriginAndFrame.get(originId);
    if (!sourceStrokesByFrame) {
      continue;
    }

    for (
      let frameIndex = 0;
      frameIndex < Math.min(remap.sourceFrameIndexByOutputFrame.length, nextTimeline.frames.length);
      frameIndex += 1
    ) {
      if (!isFrameWithinWindow(frameIndex, frameWindow)) {
        continue;
      }

      const sourceFrameIndex = remap.sourceFrameIndexByOutputFrame[frameIndex];
      if (sourceFrameIndex === null || sourceFrameIndex === undefined) {
        continue;
      }

      const sourceStrokes = sourceStrokesByFrame.get(sourceFrameIndex);
      if (!sourceStrokes || sourceStrokes.length === 0) {
        continue;
      }

      for (const stroke of sourceStrokes) {
        if (preserveWriteMetadata) {
          addExistingStrokeToFrame(nextTimeline, frameIndex, stroke);
          continue;
        }

        addStrokeToFrame(nextTimeline, frameIndex, transformStroke(stroke, null, remap.writeOrder));
      }
    }
  }

  return completeTimelineStage(nextTimeline);
};

const applyTemporalStateUpdates = (
  state: MutableGenerationState,
  temporalUpdates: ReadonlyMap<string, SceneTemporalState>,
  writeOrder: number,
): MutableGenerationState => {
  if (temporalUpdates.size === 0) {
    return state;
  }

  const timelineStateByOriginId = cloneTimelineStateByOriginId(state.timelineStateByOriginId);
  const pendingTemporalWriteOrderByOriginId = clonePendingTemporalWriteOrderByOriginId(
    state.pendingTemporalWriteOrderByOriginId,
  );

  for (const [originId, nextTemporal] of temporalUpdates.entries()) {
    const existing = timelineStateByOriginId.get(originId);
    if (!existing) {
      continue;
    }

    timelineStateByOriginId.set(originId, {
      observedWindow: cloneTimelineWindow(existing.observedWindow),
      temporal: cloneSceneTemporalState(nextTemporal),
    });
    pendingTemporalWriteOrderByOriginId.set(originId, writeOrder);
  }

  return {
    timeline: state.timeline,
    timelineStateByOriginId,
    pendingTemporalWriteOrderByOriginId,
  };
};

const buildNormalizeNonAuthoredRemaps = (
  state: MutableGenerationState,
): Map<string, OriginFrameRemap> => {
  const remaps = new Map<string, OriginFrameRemap>();
  const outputFrameCount = toFrameCount(FIXED_TIMELINE_END_BEAT, state.timeline.sampleStepBeats);

  for (const [originId, timelineState] of state.timelineStateByOriginId.entries()) {
    if (
      timelineState.temporal.hasAuthoredTimeline
      || isWindowEmpty(timelineState.observedWindow)
      || !isFixedTimelineWindow(timelineState.temporal.visibilityWindow)
    ) {
      continue;
    }

    if (
      state.timeline.timeDomainEndBeat <= FIXED_TIMELINE_END_BEAT + TIMELINE_WINDOW_EPSILON
      && isFixedTimelineWindow(timelineState.observedWindow)
    ) {
      continue;
    }

    const sourceWindow = timelineState.observedWindow;
    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      continue;
    }

    const sourceFrameIndexByOutputFrame: Array<number | null> = Array.from(
      { length: outputFrameCount },
      (_, frameIndex) => {
        const outputBeat = frameIndex * state.timeline.sampleStepBeats;
        const normalized = outputBeat / FIXED_TIMELINE_END_BEAT;
        return toSourceFrameIndex(
          sourceWindow.start + sourceSpan * normalized,
          state.timeline,
        );
      },
    );
    if (!hasMappedSourceFrame(sourceFrameIndexByOutputFrame)) {
      continue;
    }

    remaps.set(originId, {
      nextTemporal: createIdentitySceneTemporalState(),
      sourceFrameIndexByOutputFrame,
      writeOrder: 0,
    });
  }

  return remaps;
};

const buildInvariantTemporalOverrides = (
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
): Map<string, SceneTemporalState> => {
  const overrides = new Map<string, SceneTemporalState>();

  for (const [originId, timelineState] of timelineStateByOriginId.entries()) {
    overrides.set(originId, clampSceneTemporalStateToFixedLoop(timelineState.temporal));
  }

  return overrides;
};

const buildPendingTemporalMaterializationRemaps = (
  state: MutableGenerationState,
): Map<string, OriginFrameRemap> => {
  const remaps = new Map<string, OriginFrameRemap>();
  const outputFrameCount = toFrameCount(FIXED_TIMELINE_END_BEAT, state.timeline.sampleStepBeats);

  for (const [originId, timelineState] of state.timelineStateByOriginId.entries()) {
    if (!hasPendingTemporalState(timelineState)) {
      continue;
    }

    const placementWindow = resolveOutputWindow(timelineState);
    const placementSpan = placementWindow.end - placementWindow.start;
    const sourceFrameIndexByOutputFrame: Array<number | null> = !Number.isFinite(placementSpan) || placementSpan <= 0
      ? Array.from({ length: outputFrameCount }, () => null)
      : Array.from(
          { length: outputFrameCount },
          (_, frameIndex) => {
            const outputBeat = frameIndex * state.timeline.sampleStepBeats;
            if (outputBeat < placementWindow.start || outputBeat >= placementWindow.end) {
              return null;
            }

            const sourceBeat = evaluateTemporalRemap(timelineState.temporal.remap, outputBeat);
            if (sourceBeat === null || !Number.isFinite(sourceBeat)) {
              return null;
            }

            return toSourceFrameIndex(sourceBeat, state.timeline);
          },
        );

    remaps.set(originId, {
      nextTemporal: createMaterializedTemporalState(placementWindow),
      sourceFrameIndexByOutputFrame,
      writeOrder: state.pendingTemporalWriteOrderByOriginId.get(originId) ?? 0,
    });
  }

  return remaps;
};

const buildTimelineStateAfterTemporalMaterialization = (
  timeline: GeometryTimeline,
  previousTimelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  pendingOriginIds: ReadonlySet<string>,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): Map<string, OriginTimelineState> => {
  const observedWindowByOriginId = outputAdapter.buildVisibleWindowByOriginId(
    timeline,
    mutedGroupIds,
    mutedGeneratorIds,
  );
  const originIds = new Set<string>([
    ...previousTimelineStateByOriginId.keys(),
    ...observedWindowByOriginId.keys(),
  ]);

  return buildTimelineStateMap(
    originIds,
    observedWindowByOriginId,
    (originId, observedWindow) => {
      const previous = previousTimelineStateByOriginId.get(originId);
      if (!previous || !pendingOriginIds.has(originId)) {
        return cloneSceneTemporalState(previous?.temporal ?? createIdentitySceneTemporalState());
      }

      return createMaterializedTemporalState(observedWindow);
    },
  );
};

const materializePendingTemporalState = (
  state: MutableGenerationState,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const pendingOriginIds = new Set<string>();
  for (const [originId, timelineState] of state.timelineStateByOriginId.entries()) {
    if (hasPendingTemporalState(timelineState)) {
      pendingOriginIds.add(originId);
    }
  }
  if (pendingOriginIds.size === 0) {
    return state;
  }

  const remaps = buildPendingTemporalMaterializationRemaps(state);
  const timeline = remaps.size > 0
    ? remapTimeline(
        state,
        remaps,
        'all',
        FIXED_TIMELINE_END_BEAT,
        false,
      )
    : state.timeline;
  const pendingTemporalWriteOrderByOriginId = clonePendingTemporalWriteOrderByOriginId(
    state.pendingTemporalWriteOrderByOriginId,
  );
  for (const originId of pendingOriginIds) {
    pendingTemporalWriteOrderByOriginId.delete(originId);
  }

  return {
    timeline,
    timelineStateByOriginId: buildTimelineStateAfterTemporalMaterialization(
      timeline,
      state.timelineStateByOriginId,
      pendingOriginIds,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    pendingTemporalWriteOrderByOriginId,
  };
};

const clampTimelineToFixedLoop = (
  timeline: GeometryTimeline,
): GeometryTimeline => (
  timeline.timeDomainEndBeat <= FIXED_TIMELINE_END_BEAT + TIMELINE_WINDOW_EPSILON
    && timeline.frames.length === toFrameCount(FIXED_TIMELINE_END_BEAT, timeline.sampleStepBeats)
)
  ? timeline
  : completeTimelineStage(beginTimelineStage(timeline, FIXED_TIMELINE_END_BEAT));

const sealStageWithTemporalInvariant = (
  state: MutableGenerationState,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const temporalOverrides = buildInvariantTemporalOverrides(state.timelineStateByOriginId);
  const normalizeRemaps = buildNormalizeNonAuthoredRemaps(state);
  const nextTimeline = normalizeRemaps.size > 0
    ? remapTimeline(
        state,
        normalizeRemaps,
        'all',
        FIXED_TIMELINE_END_BEAT,
        true,
      )
    : clampTimelineToFixedLoop(state.timeline);

  return {
    timeline: nextTimeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      nextTimeline,
      state.timelineStateByOriginId,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
      normalizeRemaps.size > 0
        ? new Map([
            ...temporalOverrides,
            ...Array.from(
              normalizeRemaps.entries(),
              ([originId, remap]) => [originId, remap.nextTemporal] as const,
            ),
          ])
        : temporalOverrides,
    ),
    pendingTemporalWriteOrderByOriginId: normalizeRemaps.size > 0
      ? new Map<string, number>()
      : clonePendingTemporalWriteOrderByOriginId(state.pendingTemporalWriteOrderByOriginId),
  };
};

const buildTemporalStateUpdatesForTargetOrigins = (
  state: MutableGenerationState,
  targetGroupId: string | null,
  requiredFrameWindow: BeatRange | 'all',
  resolveTemporalState: (
    originId: string,
    timelineState: OriginTimelineState | undefined,
    frameWindow: FrameWindow,
  ) => SceneTemporalState | null,
): Map<string, SceneTemporalState> => {
  const temporalUpdates = new Map<string, SceneTemporalState>();
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    state.timeline.frames.length,
  );

  for (const originId of buildTargetOriginIds(state.timeline, targetGroupId)) {
    const nextTemporal = resolveTemporalState(
      originId,
      state.timelineStateByOriginId.get(originId),
      frameWindow,
    );
    if (nextTemporal) {
      temporalUpdates.set(originId, nextTemporal);
    }
  }

  return temporalUpdates;
};

const hasApplicableFrame = (
  timeline: GeometryTimeline,
  frameWindow: FrameWindow,
  isApplicableAtFrame: (frameIndex: number, outputBeat: number) => boolean,
): boolean => {
  for (let frameIndex = 0; frameIndex < timeline.frames.length; frameIndex += 1) {
    if (!isFrameWithinWindow(frameIndex, frameWindow)) {
      continue;
    }

    const outputBeat = frameIndex * timeline.sampleStepBeats;
    if (isApplicableAtFrame(frameIndex, outputBeat)) {
      return true;
    }
  }

  return false;
};

const resolveLastModulatedTemporalState = <TEffect extends GeneratorEffectNode>(
  state: MutableGenerationState,
  effect: TEffect,
  modulationContext: ModulationContext,
  frameWindow: FrameWindow,
  resolveTemporalStateAtFrame: (deviceAtFrame: TEffect, frameIndex: number) => SceneTemporalState | null,
): SceneTemporalState | null => {
  let nextTemporal: SceneTemporalState | null = null;

  for (let frameIndex = 0; frameIndex < state.timeline.frames.length; frameIndex += 1) {
    if (!isFrameWithinWindow(frameIndex, frameWindow)) {
      continue;
    }

    const deviceAtFrame = resolveModulatedDeviceAtFrame(
      modulationContext,
      effect,
      frameIndex,
      state.timeline.sampleStepBeats,
    ) as TEffect;
    const temporalState = resolveTemporalStateAtFrame(deviceAtFrame, frameIndex);
    if (temporalState) {
      nextTemporal = temporalState;
    }
  }

  return nextTemporal;
};

const buildReverseRemaps = (
  state: MutableGenerationState,
  targetGroupId: string | null,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, SceneTemporalState> => buildTemporalStateUpdatesForTargetOrigins(
  state,
  targetGroupId,
  requiredFrameWindow,
  (_originId, timelineState, frameWindow) => {
    const placementWindow = resolveOutputWindow(timelineState);
    const placementSpan = placementWindow.end - placementWindow.start;
    if (!Number.isFinite(placementSpan) || placementSpan <= 0) {
      return null;
    }

    if (!hasApplicableFrame(
      state.timeline,
      frameWindow,
      (_frameIndex, outputBeat) => outputBeat >= placementWindow.start && outputBeat < placementWindow.end,
    )) {
      return null;
    }

    return composeSceneTemporalState(
      timelineState?.temporal ?? createIdentitySceneTemporalState(),
      buildPlacementPreservingReverseTransform(placementWindow),
    );
  },
);

const buildTrimRemaps = (
  state: MutableGenerationState,
  effect: TrimEffectNode,
  targetGroupId: string | null,
  modulationContext: ModulationContext,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, SceneTemporalState> => buildTemporalStateUpdatesForTargetOrigins(
  state,
  targetGroupId,
  requiredFrameWindow,
  (_originId, timelineState, frameWindow) => {
    return resolveLastModulatedTemporalState(
      state,
      effect,
      modulationContext,
      frameWindow,
      (deviceAtFrame) => {
        const start = deviceAtFrame.params.start;
        const end = deviceAtFrame.params.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end <= start) {
          return null;
        }

        return composeSceneTemporalState(
          timelineState?.temporal ?? createIdentitySceneTemporalState(),
          buildNormalizedTrimTransform(DEFAULT_TIMELINE_WINDOW, start, end),
        );
      },
    );
  },
);

const buildStretchRemaps = (
  state: MutableGenerationState,
  effect: StretchEffectNode,
  targetGroupId: string | null,
  modulationContext: ModulationContext,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, SceneTemporalState> => buildTemporalStateUpdatesForTargetOrigins(
  state,
  targetGroupId,
  requiredFrameWindow,
  (originId, timelineState, frameWindow) => {
    const sourceWindow = resolveSourceWindow(state.timelineStateByOriginId, originId);
    if (!sourceWindow) {
      return null;
    }

    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      return null;
    }

    return resolveLastModulatedTemporalState(
      state,
      effect,
      modulationContext,
      frameWindow,
      (deviceAtFrame, frameIndex) => {
        const outputBeat = frameIndex * state.timeline.sampleStepBeats;
        const start = deviceAtFrame.params.start;
        const end = deviceAtFrame.params.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end <= start) {
          return null;
        }
        if (outputBeat < start || outputBeat >= end) {
          return null;
        }

        return composeSceneTemporalState(
          timelineState?.temporal ?? createIdentitySceneTemporalState(),
          buildStretchTransform(sourceWindow, start, end),
        );
      },
    );
  },
);

const buildTimeWarpRemaps = (
  state: MutableGenerationState,
  effect: TimeWarpEffectNode,
  targetGroupId: string | null,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, SceneTemporalState> => {
  if (isIdentityTimeWarpCurve(effect.params.curve)) {
    return new Map<string, SceneTemporalState>();
  }

  const remap = createSampledRemapFromTimeWarpCurve(effect.params.curve);
  return buildTemporalStateUpdatesForTargetOrigins(
    state,
    targetGroupId,
    requiredFrameWindow,
    (_originId, timelineState, frameWindow) => {
      const placementWindow = resolveOutputWindow(timelineState);
      const placementSpan = placementWindow.end - placementWindow.start;
      if (!Number.isFinite(placementSpan) || placementSpan <= 0) {
        return null;
      }

      if (!hasApplicableFrame(
        state.timeline,
        frameWindow,
        (_frameIndex, outputBeat) => {
          if (outputBeat < placementWindow.start || outputBeat >= placementWindow.end) {
            return false;
          }

          const normalized = (outputBeat - placementWindow.start) / placementSpan;
          const remappedBeat = evaluateTemporalRemap(remap, normalized);
          return remappedBeat !== null && Number.isFinite(remappedBeat);
        },
      )) {
        return null;
      }

      return composeSceneTemporalState(
        timelineState?.temporal ?? createIdentitySceneTemporalState(),
        buildPlacementPreservingTimeWarpTransform(placementWindow, remap),
      );
    },
  );
};

const resolveMaskSourceTimeReversed = (
  chain: GeneratorChain,
  targetGroupId: string | null,
  consumingDeviceIndex: number,
): boolean => {
  let reverseParity = false;

  for (let index = chain.devices.length - 1; index > consumingDeviceIndex; index -= 1) {
    const device = chain.devices[index];
    const deviceGroupId = normalizeOptionalId(device.groupId);
    const affectsTarget = deviceGroupId === null || deviceGroupId === targetGroupId;
    if (
      affectsTarget
      && isDeviceEffectivelyEnabled(chain, device)
      && doesDeviceToggleTimelineParity(device)
    ) {
      reverseParity = !reverseParity;
    }
  }

  return reverseParity;
};

const resolveMaskSourceMask = (
  sourceTimeline: GeometryTimeline,
  chain: GeneratorChain,
  effect: MaskEffectNode,
  consumingDeviceIndex: number,
  outputAdapter: CanonicalOutputAdapter,
  targetGroupId: string | null,
  frameIndex: number,
): GeometryMask => {
  if (effect.params.sourceKind === 'tiles') {
    const mask = outputAdapter.createMaskFromViewportTiles(effect.params.tiles);
    return createIdentityMask(mask.contains);
  }

  const sourceId = normalizeOptionalId(effect.params.sourceId);
  if (!sourceId) {
    return createIdentityMask(() => false);
  }

  const isTimeReversed = resolveMaskSourceTimeReversed(
    chain,
    targetGroupId,
    consumingDeviceIndex,
  );
  const resolvedFrameIndex = isTimeReversed
    ? Math.max(sourceTimeline.frames.length - 1 - frameIndex, 0)
    : frameIndex;
  if (resolvedFrameIndex < 0 || resolvedFrameIndex >= sourceTimeline.frames.length) {
    return createIdentityMask(() => false);
  }

  const sourceStrokes = sourceTimeline.frames[resolvedFrameIndex].strokes.filter((stroke) => (
    effect.params.sourceKind === 'group'
      ? stroke.originGroupId === sourceId
      : stroke.polyline.originId === sourceId
  ));
  const coordinates = collectOccupiedCoordinates(
    sourceStrokes,
    effect.params.sourceDomain === 'activation',
  );
  return createIdentityMask(createCoordinateMask(coordinates));
};

const applyMaskEffect = (
  state: MutableGenerationState,
  chain: GeneratorChain,
  effect: MaskEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  consumingDeviceIndex: number,
  outputAdapter: CanonicalOutputAdapter,
  executionPlan: OperatorExecutionPlan,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const sourceTimeline = state.timeline;
  const nextTimeline = beginTimelineStage(state.timeline);
  const targetFrameWindow = resolveFrameWindow(
    executionPlan.requiredFrameWindow,
    state.timeline.sampleStepBeats,
    sourceTimeline.frames.length,
  );

  forEachTargetedFrame(nextTimeline, sourceTimeline.frames.length, targetGroupId, targetFrameWindow, (frameIndex, targeted) => {
    const mask = resolveMaskSourceMask(
      sourceTimeline,
      chain,
      effect,
      consumingDeviceIndex,
      outputAdapter,
      targetGroupId,
      frameIndex,
    );

    for (const stroke of targeted) {
      addStrokeToFrame(nextTimeline, frameIndex, {
        ...cloneStrokeWithWriteOrder(stroke, writeOrder),
        masks: [
          ...stroke.masks.map(cloneMask),
          effect.params.mode === 'include'
            ? mask
            : createIdentityMask((x, y) => !mask.contains(x, y)),
        ],
      });
    }
  });

  const sealedTimeline = completeTimelineStage(nextTimeline);
  return {
    timeline: sealedTimeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      sealedTimeline,
      state.timelineStateByOriginId,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    pendingTemporalWriteOrderByOriginId: clonePendingTemporalWriteOrderByOriginId(
      state.pendingTemporalWriteOrderByOriginId,
    ),
  };
};

interface ColorTimingSegment extends TimedColorSource {
  originId: string;
}

const groupActivationSegmentsByOriginId = (
  segments: ReadonlyArray<GeometryActivationSegment>,
): Map<string, ColorTimingSegment[]> => {
  const rawSegmentsByOriginId = new Map<string, ColorTimingSegment[]>();

  for (const segment of segments) {
    if (
      !Number.isFinite(segment.startBeat)
      || !Number.isFinite(segment.endBeat)
      || segment.endBeat <= segment.startBeat
    ) {
      continue;
    }

    const existingSegments = rawSegmentsByOriginId.get(segment.originId);
    if (existingSegments) {
      existingSegments.push({
        originId: segment.originId,
        startBeat: segment.startBeat,
        endBeat: segment.endBeat,
      });
      continue;
    }

    rawSegmentsByOriginId.set(segment.originId, [{
      originId: segment.originId,
      startBeat: segment.startBeat,
      endBeat: segment.endBeat,
    }]);
  }

  const segmentsByOriginId = new Map<string, ColorTimingSegment[]>();
  for (const [originId, rawSegments] of rawSegmentsByOriginId.entries()) {
    if (rawSegments.length === 0) {
      continue;
    }

    const orderedSegments = [...rawSegments].sort((left, right) => (
      left.startBeat - right.startBeat || left.endBeat - right.endBeat
    ));
    const mergedSegments: ColorTimingSegment[] = [];

    for (const currentSegment of orderedSegments) {
      const previousSegment = mergedSegments[mergedSegments.length - 1];
      if (!previousSegment || currentSegment.startBeat > previousSegment.endBeat + TIMELINE_WINDOW_EPSILON) {
        mergedSegments.push({
          originId,
          startBeat: currentSegment.startBeat,
          endBeat: currentSegment.endBeat,
        });
        continue;
      }

      previousSegment.endBeat = Math.max(previousSegment.endBeat, currentSegment.endBeat);
    }

    if (mergedSegments.length > 0) {
      segmentsByOriginId.set(originId, mergedSegments);
    }
  }

  return segmentsByOriginId;
};

const applyColorEffect = (
  state: MutableGenerationState,
  effect: ColorEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const nextTimeline = beginTimelineStage(state.timeline);
  const colorConfig = buildColorConfig(effect);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    state.timeline.frames.length,
  );
  const targetSegmentsByOriginId = groupActivationSegmentsByOriginId(
    collectActivationSegments(
      state.timeline,
      (stroke) => isTargetedStroke(stroke, targetGroupId),
    ),
  );
  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(
    state.timeline,
    new Set(targetSegmentsByOriginId.keys()),
  );

  stripTargetedFrames(nextTimeline, state.timeline.frames.length, targetGroupId);

  for (const [originId, sourceSegments] of targetSegmentsByOriginId.entries()) {
    const sourceStrokesByFrame = sourceStrokesByOriginAndFrame.get(originId);
    if (!sourceStrokesByFrame) {
      continue;
    }

    const slots = planColorProgramSlots(sourceSegments, colorConfig);
    if (slots.length === 0) {
      continue;
    }

    for (const slot of slots) {
      ensureTimelineFrameCount(nextTimeline, slot.endBeat);
      const sourceFrameWindow = resolveColorSlotSourceFrameWindow(slot, state.timeline);
      const destinationFrameWindow = resolveColorSlotDestinationFrameWindow(slot, nextTimeline);

      for (
        let sourceFrameIndex = sourceFrameWindow.startFrame;
        sourceFrameIndex < sourceFrameWindow.endFrameExclusive;
        sourceFrameIndex += 1
      ) {
        const destinationFrameIndex = resolveColorDestinationFrameIndex(
          sourceFrameIndex,
          slot.offset,
          nextTimeline.sampleStepBeats,
        );
        if (
          !isFrameWithinWindow(destinationFrameIndex, frameWindow)
          || !isFrameWithinWindow(destinationFrameIndex, destinationFrameWindow)
        ) {
          continue;
        }

        const sourceStrokes = sourceStrokesByFrame.get(sourceFrameIndex);
        if (!sourceStrokes || sourceStrokes.length === 0) {
          continue;
        }

        for (const stroke of sourceStrokes) {
          addStrokeToFrame(
            nextTimeline,
            destinationFrameIndex,
            cloneStrokeWithVelocityAndWriteOrder(stroke, slot.velocity, writeOrder),
          );
        }
      }
    }
  }

  const sealedTimeline = completeTimelineStage(nextTimeline);
  return {
    timeline: sealedTimeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      sealedTimeline,
      state.timelineStateByOriginId,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    pendingTemporalWriteOrderByOriginId: clonePendingTemporalWriteOrderByOriginId(
      state.pendingTemporalWriteOrderByOriginId,
    ),
  };
};

const resolveEffectTransform = (
  effect: GeneratorEffectNode,
): ReturnType<typeof toTranslationTransform> | null => {
  if (effect.kind === 'mirror') {
    return toMirrorTransformAt(effect.params.angleDeg, COMPOSITION_CENTER);
  }

  if (effect.kind === 'rotate') {
    return toRotateTransformAt(effect.params.angleDeg, COMPOSITION_CENTER);
  }

  if (effect.kind === 'translate') {
    return toTranslationTransform(effect.params.offsetX, effect.params.offsetY);
  }

  if (effect.kind === 'scale') {
    return toScaleTransformAt(
      effect.params.scaleX,
      effect.params.scaleY,
      {
        x: effect.params.centerX,
        y: effect.params.centerY,
      },
    );
  }

  return null;
};

const isGeneratorStage = (
  stage: CompiledRackStage,
): boolean => stage.deviceKind === 'waterdrop'
  || stage.deviceKind === 'scanner'
  || stage.deviceKind === 'spiral'
  || stage.deviceKind === 'path';

const isTemporalEffectDevice = (
  device: GeneratorEffectNode,
): boolean => device.kind === 'reverse'
  || device.kind === 'trim'
  || device.kind === 'stretch'
  || device.kind === 'timewarp';

const applyEffectDevice = (
  state: MutableGenerationState,
  chain: GeneratorChain,
  stage: CompiledRackStage,
  outputAdapter: CanonicalOutputAdapter,
  modulationContext: ModulationContext,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const device = stage.device as GeneratorEffectNode;
  const deviceIndex = stage.stageIndex;
  const targetGroupId = normalizeOptionalId(device.groupId);
  const executionPlan = resolveDeviceExecutionPlan(executionPlanByDeviceId, device.id);

  if (device.kind === 'mask') {
    return applyMaskEffect(
      state,
      chain,
      device,
      targetGroupId,
      deviceIndex,
      deviceIndex,
      outputAdapter,
      executionPlan,
      mutedGroupIds,
      mutedGeneratorIds,
    );
  }

  if (device.kind === 'color') {
    return applyColorEffect(
      state,
      device,
      targetGroupId,
      deviceIndex,
      executionPlan.requiredFrameWindow,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    );
  }

  if (device.kind === 'symmetry') {
    return applySymmetryEffect(
      state,
      device,
      targetGroupId,
      deviceIndex,
      executionPlan.requiredFrameWindow,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    );
  }

  if (device.kind === 'reverse') {
    const temporalUpdates = buildReverseRemaps(
      state,
      targetGroupId,
      'all',
    );
    return temporalUpdates.size > 0
      ? applyTemporalStateUpdates(
          state,
          temporalUpdates,
          deviceIndex,
        )
      : state;
  }

  if (device.kind === 'trim') {
    const temporalUpdates = buildTrimRemaps(
      state,
      device,
      targetGroupId,
      modulationContext,
      'all',
    );
    return temporalUpdates.size > 0
      ? applyTemporalStateUpdates(
          state,
          temporalUpdates,
          deviceIndex,
        )
      : state;
  }

  if (device.kind === 'stretch') {
    const temporalUpdates = buildStretchRemaps(
      state,
      device,
      targetGroupId,
      modulationContext,
      'all',
    );
    return temporalUpdates.size > 0
      ? applyTemporalStateUpdates(
          state,
          temporalUpdates,
          deviceIndex,
        )
      : state;
  }

  if (device.kind === 'timewarp') {
    const temporalUpdates = buildTimeWarpRemaps(
      state,
      device,
      targetGroupId,
      'all',
    );
    return temporalUpdates.size > 0
      ? applyTemporalStateUpdates(
          state,
          temporalUpdates,
          deviceIndex,
        )
      : state;
  }

  return applySpatialTransform(
    state,
    targetGroupId,
    deviceIndex,
    (frameIndex) => resolveEffectTransform(
      resolveModulatedDeviceAtFrame(
        modulationContext,
        device,
        frameIndex,
        state.timeline.sampleStepBeats,
      ) as GeneratorEffectNode,
    ),
    executionPlan.requiredFrameWindow,
    outputAdapter,
    mutedGroupIds,
    mutedGeneratorIds,
  );
};

const applyGeneratorDevice = (
  state: MutableGenerationState,
  stage: CompiledRackStage,
  modulationContext: ModulationContext,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const device = stage.device as GeneratorNode;
  const deviceIndex = stage.stageIndex;
  const nextTimeline = beginTimelineStage(state.timeline);
  ensureTimelineFrameCount(nextTimeline, 1);
  const executionPlan = resolveDeviceExecutionPlan(executionPlanByDeviceId, device.id);
  const frameWindow = resolveFrameWindow(
    executionPlan.requiredFrameWindow,
    nextTimeline.sampleStepBeats,
    nextTimeline.frames.length,
  );

  for (let frameIndex = frameWindow.startFrame; frameIndex < frameWindow.endFrameExclusive; frameIndex += 1) {
    rasterizeGeneratorFrame(
      nextTimeline,
      frameIndex,
      resolveModulatedDeviceAtFrame(
        modulationContext,
        device,
        frameIndex,
        nextTimeline.sampleStepBeats,
      ) as GeneratorNode,
      deviceIndex,
      executionPlan.requiredOutputBounds,
    );
  }

  const sealedTimeline = completeTimelineStage(nextTimeline);
  const seededTimelineStateByOriginId = cloneTimelineStateByOriginId(state.timelineStateByOriginId);
  seededTimelineStateByOriginId.set(device.id, {
    observedWindow: EMPTY_TIMELINE_WINDOW,
    temporal: createIdentitySceneTemporalState(),
  });
  return {
    timeline: sealedTimeline,
    timelineStateByOriginId: buildTimelineStateByOriginId(
      sealedTimeline,
      seededTimelineStateByOriginId,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    pendingTemporalWriteOrderByOriginId: clonePendingTemporalWriteOrderByOriginId(
      state.pendingTemporalWriteOrderByOriginId,
    ),
  };
};

const applyCompiledRackStage = (
  state: MutableGenerationState,
  compiledPlan: CompiledRackPlan,
  stage: CompiledRackStage,
  outputAdapter: CanonicalOutputAdapter,
  modulationContext: ModulationContext,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  if (isGeneratorStage(stage)) {
    return sealStageWithTemporalInvariant(
      applyGeneratorDevice(
        materializePendingTemporalState(
          state,
          outputAdapter,
          mutedGroupIds,
          mutedGeneratorIds,
        ),
        stage,
        modulationContext,
        executionPlanByDeviceId,
        outputAdapter,
        mutedGroupIds,
        mutedGeneratorIds,
      ),
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    );
  }

  const device = stage.device as GeneratorEffectNode;
  if (isTemporalEffectDevice(device)) {
    return applyEffectDevice(
      state,
      compiledPlan.baseChain,
      stage,
      outputAdapter,
      modulationContext,
      executionPlanByDeviceId,
      mutedGroupIds,
      mutedGeneratorIds,
    );
  }

  return sealStageWithTemporalInvariant(
    applyEffectDevice(
      materializePendingTemporalState(
        state,
        outputAdapter,
        mutedGroupIds,
        mutedGeneratorIds,
      ),
      compiledPlan.baseChain,
      stage,
      outputAdapter,
      modulationContext,
      executionPlanByDeviceId,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    outputAdapter,
    mutedGroupIds,
    mutedGeneratorIds,
  );
};

const executeCompiledRackPlan = (
  compiledPlan: CompiledRackPlan,
  modulationChain: GeneratorChain,
  loopLengthBeats: number,
  outputAdapter: CanonicalOutputAdapter,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const modulationContext = createModulationContext(modulationChain, loopLengthBeats);
  let currentState: MutableGenerationState = {
    timeline: createEmptyTimeline(),
    timelineStateByOriginId: new Map<string, OriginTimelineState>(),
    pendingTemporalWriteOrderByOriginId: new Map<string, number>(),
  };

  for (const stage of compiledPlan.stages) {
    currentState = applyCompiledRackStage(
      currentState,
      compiledPlan,
      stage,
      outputAdapter,
      modulationContext,
      executionPlanByDeviceId,
      mutedGroupIds,
      mutedGeneratorIds,
    );
  }

  return sealStageWithTemporalInvariant(
    materializePendingTemporalState(
      currentState,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
    ),
    outputAdapter,
    mutedGroupIds,
    mutedGeneratorIds,
  );
};

export const buildCanonicalFieldResult = (
  chain: GeneratorChain,
  loopLengthBeats: number,
  outputAdapter: CanonicalOutputAdapter,
  executionRequest: CanonicalExecutionRequest,
): CanonicalFieldResult => {
  const compiledPlan = buildCompiledRackPlan(chain, loopLengthBeats);
  const executionPlan = buildCanonicalExecutionPlan(compiledPlan.baseChain, executionRequest);
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(compiledPlan.baseChain);
  const executionState = executeCompiledRackPlan(
    compiledPlan,
    chain,
    loopLengthBeats,
    outputAdapter,
    executionPlan.byDeviceId,
    mutedGroupIds,
    mutedGeneratorIds,
  );
  const timeline = finalizeTimeline(executionState.timeline);

  return {
    loopLengthBeats,
    timeline,
    sourceTimelineEndBeat: loopLengthBeats,
    sampleStepBeats: timeline.sampleStepBeats,
    mutedGroupIds,
    mutedGeneratorIds,
    analysis: compiledPlan.analysis,
    executionPlan,
    compiledPlan,
    timelineStateByOriginId: executionState.timelineStateByOriginId,
  };
};
