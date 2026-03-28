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
import { evaluateTemporalRemap } from '../core/scene-operators/temporal';
import { createSampledRemapFromTimeWarpCurve, isIdentityTimeWarpCurve } from '../core/timewarp/curve';
import {
  buildColorConfig,
  planColorProgramSlots,
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
  addStrokeToFrame,
  cloneStroke,
  cloneTimeline,
  createEmptyTimeline,
  createIdentityMask,
  ensureTimelineFrameCount,
  finalizeTimeline,
  toFrameWindow,
  type FrameWindow,
} from './timeline';
import type {
  CanonicalFieldResult,
  CanonicalSpatialAdapter,
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
}

interface ModulationContext {
  loopLengthBeats: number;
  program: CompiledModulationProgram;
  deviceByFrameKey: Map<string, GeneratorDeviceNode>;
}

interface OriginTemporalRemap {
  nextTimelineAuthored: boolean;
  sourceFrameIndexByOutputFrame: ReadonlyArray<number | null>;
}

const DEFAULT_TIMELINE_WINDOW: TimelineWindow = Object.freeze({
  start: 0,
  end: 1,
});

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
      authored: timelineState.authored,
      window: {
        start: timelineState.window.start,
        end: timelineState.window.end,
      },
    },
  ]),
);

const createModulationContext = (
  chain: GeneratorChain,
  loopLengthBeats: number,
): ModulationContext => ({
  loopLengthBeats,
  program: compileModulationProgram(chain),
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
      untargeted.push(cloneStroke(stroke));
    }
  }

  return {
    targeted,
    untargeted,
  };
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

const buildOccupiedWindowByOriginId = (
  timeline: GeometryTimeline,
): Map<string, TimelineWindow> => {
  const windowByOriginId = new Map<string, TimelineWindow>();

  for (let frameIndex = 0; frameIndex < timeline.frames.length; frameIndex += 1) {
    const frameStart = frameIndex * timeline.sampleStepBeats;
    const frameEnd = (frameIndex + 1) * timeline.sampleStepBeats;

    for (const stroke of timeline.frames[frameIndex].strokes) {
      const existing = windowByOriginId.get(stroke.polyline.originId);
      if (existing) {
        if (frameStart < existing.start) {
          existing.start = frameStart;
        }
        if (frameEnd > existing.end) {
          existing.end = frameEnd;
        }
      } else {
        windowByOriginId.set(stroke.polyline.originId, {
          start: frameStart,
          end: frameEnd,
        });
      }
    }
  }

  return windowByOriginId;
};

const resolveSourceWindow = (
  originId: string,
  timelineStateByOriginId: ReadonlyMap<string, OriginTimelineState>,
  occupiedWindowByOriginId: ReadonlyMap<string, TimelineWindow>,
): TimelineWindow => {
  const timelineState = timelineStateByOriginId.get(originId);
  if (timelineState?.authored === true) {
    return timelineState.window;
  }

  return occupiedWindowByOriginId.get(originId) ?? timelineState?.window ?? DEFAULT_TIMELINE_WINDOW;
};

const resolvePassthroughEndBeat = (
  timeline: GeometryTimeline,
  targetGroupId: string | null,
): number => {
  let maxEndBeat = 0;

  for (let frameIndex = 0; frameIndex < timeline.frames.length; frameIndex += 1) {
    const frameEndBeat = (frameIndex + 1) * timeline.sampleStepBeats;
    for (const stroke of timeline.frames[frameIndex].strokes) {
      if (isTargetedStroke(stroke, targetGroupId)) {
        continue;
      }

      if (frameEndBeat > maxEndBeat) {
        maxEndBeat = frameEndBeat;
      }
    }
  }

  return maxEndBeat;
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
): MutableGenerationState => {
  const nextTimeline = createEmptyTimeline(state.timeline.sampleStepBeats, state.timeline.timeDomainEndBeat);
  nextTimeline.nextWriteId = state.timeline.nextWriteId;
  ensureTimelineFrameCount(nextTimeline, state.timeline.timeDomainEndBeat);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    state.timeline.frames.length,
  );

  for (let frameIndex = 0; frameIndex < state.timeline.frames.length; frameIndex += 1) {
    const transform = resolveTransformAtFrame(frameIndex);
    const { targeted, untargeted } = splitFrameStrokesByTarget(
      state.timeline.frames[frameIndex].strokes,
      targetGroupId,
    );
    nextTimeline.frames[frameIndex].strokes.push(...untargeted);

    if (!isFrameWithinWindow(frameIndex, frameWindow)) {
      continue;
    }

    for (const stroke of targeted) {
      addStrokeToFrame(nextTimeline, frameIndex, transformStroke(stroke, transform, writeOrder));
    }
  }

  nextTimeline.timeDomainEndBeat = state.timeline.timeDomainEndBeat;
  return {
    timeline: finalizeTimeline(nextTimeline),
    timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
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
): MutableGenerationState => {
  const nextTimeline = createEmptyTimeline(state.timeline.sampleStepBeats, state.timeline.timeDomainEndBeat);
  nextTimeline.nextWriteId = state.timeline.nextWriteId;
  ensureTimelineFrameCount(nextTimeline, state.timeline.timeDomainEndBeat);
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

  for (let frameIndex = 0; frameIndex < state.timeline.frames.length; frameIndex += 1) {
    const { targeted, untargeted } = splitFrameStrokesByTarget(
      state.timeline.frames[frameIndex].strokes,
      targetGroupId,
    );
    nextTimeline.frames[frameIndex].strokes.push(...untargeted);

    if (!isFrameWithinWindow(frameIndex, frameWindow)) {
      continue;
    }

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
  }

  return {
    timeline: finalizeTimeline(nextTimeline),
    timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
  };
};

const applyQuadMirrorSymmetry = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  const nextTimeline = createEmptyTimeline(state.timeline.sampleStepBeats, state.timeline.timeDomainEndBeat);
  nextTimeline.nextWriteId = state.timeline.nextWriteId;
  ensureTimelineFrameCount(nextTimeline, state.timeline.timeDomainEndBeat);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    state.timeline.frames.length,
  );

  const quadrants: ReadonlyArray<SymmetryEffectNode['params']['sourceAnchor']> = ['bl', 'br', 'tr', 'tl'];
  const sourceKeepMinX = effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'tl';
  const sourceKeepMinY = effect.params.sourceAnchor === 'bl' || effect.params.sourceAnchor === 'br';

  for (let frameIndex = 0; frameIndex < state.timeline.frames.length; frameIndex += 1) {
    const { targeted, untargeted } = splitFrameStrokesByTarget(
      state.timeline.frames[frameIndex].strokes,
      targetGroupId,
    );
    nextTimeline.frames[frameIndex].strokes.push(...untargeted);

    if (!isFrameWithinWindow(frameIndex, frameWindow)) {
      continue;
    }

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
  }

  return {
    timeline: finalizeTimeline(nextTimeline),
    timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
  };
};

const applyQuadPinwheelSymmetry = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  const nextTimeline = createEmptyTimeline(state.timeline.sampleStepBeats, state.timeline.timeDomainEndBeat);
  nextTimeline.nextWriteId = state.timeline.nextWriteId;
  ensureTimelineFrameCount(nextTimeline, state.timeline.timeDomainEndBeat);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    state.timeline.frames.length,
  );

  const quadrants: ReadonlyArray<SymmetryEffectNode['params']['sourceAnchor']> = ['bl', 'br', 'tr', 'tl'];
  const sourceIndex = quadrants.findIndex((quadrant) => quadrant === effect.params.sourceAnchor);

  for (let frameIndex = 0; frameIndex < state.timeline.frames.length; frameIndex += 1) {
    const { targeted, untargeted } = splitFrameStrokesByTarget(
      state.timeline.frames[frameIndex].strokes,
      targetGroupId,
    );
    nextTimeline.frames[frameIndex].strokes.push(...untargeted);

    if (!isFrameWithinWindow(frameIndex, frameWindow)) {
      continue;
    }

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
  }

  return {
    timeline: finalizeTimeline(nextTimeline),
    timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
  };
};

const applySymmetryEffect = (
  state: MutableGenerationState,
  effect: SymmetryEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  if (effect.params.mode === 'mirror-half') {
    return applyMirrorHalfSymmetry(
      state,
      effect,
      targetGroupId,
      writeOrder,
      requiredFrameWindow,
    );
  }

  if (effect.params.mode === 'quad-mirror') {
    return applyQuadMirrorSymmetry(
      state,
      effect,
      targetGroupId,
      writeOrder,
      requiredFrameWindow,
    );
  }

  return applyQuadPinwheelSymmetry(
    state,
    effect,
    targetGroupId,
    writeOrder,
    requiredFrameWindow,
  );
};

const buildSourceStrokesByOriginAndFrame = (
  timeline: GeometryTimeline,
  targetGroupId: string | null,
): Map<string, Map<number, GeometryStroke[]>> => {
  const strokesByOriginId = new Map<string, Map<number, GeometryStroke[]>>();

  for (let frameIndex = 0; frameIndex < timeline.frames.length; frameIndex += 1) {
    for (const stroke of timeline.frames[frameIndex].strokes) {
      if (!isTargetedStroke(stroke, targetGroupId)) {
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

const resolveTemporalOutputFrameCount = (
  state: MutableGenerationState,
  targetGroupId: string | null,
): number => {
  let maxEndBeat = state.timeline.timeDomainEndBeat;
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.timeline);

  for (const originId of buildTargetOriginIds(state.timeline, targetGroupId)) {
    const sourceWindow = resolveSourceWindow(
      originId,
      state.timelineStateByOriginId,
      occupiedWindowByOriginId,
    );
    if (sourceWindow.end > maxEndBeat) {
      maxEndBeat = sourceWindow.end;
    }

    const timelineState = state.timelineStateByOriginId.get(originId);
    if (timelineState && timelineState.window.end > maxEndBeat) {
      maxEndBeat = timelineState.window.end;
    }
  }

  return Math.max(Math.ceil(maxEndBeat / state.timeline.sampleStepBeats), 1);
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

const hasMappedSourceFrame = (
  sourceFrameIndexByOutputFrame: ReadonlyArray<number | null>,
): boolean => sourceFrameIndexByOutputFrame.some((frameIndex) => frameIndex !== null);

const applyTemporalRemap = (
  state: MutableGenerationState,
  targetGroupId: string | null,
  remaps: ReadonlyMap<string, OriginTemporalRemap>,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  const passthroughEndBeat = resolvePassthroughEndBeat(state.timeline, targetGroupId);
  const passthroughFrameCount = Math.max(
    Math.ceil(passthroughEndBeat / state.timeline.sampleStepBeats),
    1,
  );
  let outputFrameCount = passthroughFrameCount;
  for (const remap of remaps.values()) {
    if (remap.sourceFrameIndexByOutputFrame.length > outputFrameCount) {
      outputFrameCount = remap.sourceFrameIndexByOutputFrame.length;
    }
  }
  const outputEndBeat = outputFrameCount * state.timeline.sampleStepBeats;
  const nextTimeline = createEmptyTimeline(state.timeline.sampleStepBeats, outputEndBeat);
  nextTimeline.nextWriteId = state.timeline.nextWriteId;
  ensureTimelineFrameCount(nextTimeline, outputEndBeat);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    nextTimeline.frames.length,
  );

  for (let frameIndex = 0; frameIndex < state.timeline.frames.length; frameIndex += 1) {
    for (const stroke of state.timeline.frames[frameIndex].strokes) {
      if (isTargetedStroke(stroke, targetGroupId)) {
        continue;
      }

      if (frameIndex < nextTimeline.frames.length) {
        nextTimeline.frames[frameIndex].strokes.push(cloneStroke(stroke));
      }
    }
  }

  const sourceStrokesByOriginAndFrame = buildSourceStrokesByOriginAndFrame(state.timeline, targetGroupId);
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
        addStrokeToFrame(nextTimeline, frameIndex, transformStroke(stroke, null, writeOrder));
      }
    }
  }

  const finalizedTimeline = finalizeTimeline(nextTimeline);
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(finalizedTimeline);
  const nextTimelineStateByOriginId = cloneTimelineStateByOriginId(state.timelineStateByOriginId);
  for (const [originId, remap] of remaps.entries()) {
    const occupiedWindow = occupiedWindowByOriginId.get(originId)
      ?? state.timelineStateByOriginId.get(originId)?.window
      ?? DEFAULT_TIMELINE_WINDOW;
    nextTimelineStateByOriginId.set(originId, {
      authored: remap.nextTimelineAuthored,
      window: {
        start: occupiedWindow.start,
        end: occupiedWindow.end,
      },
    });
  }

  return {
    timeline: finalizedTimeline,
    timelineStateByOriginId: nextTimelineStateByOriginId,
  };
};

const buildReverseRemaps = (
  state: MutableGenerationState,
  targetGroupId: string | null,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, OriginTemporalRemap> => {
  const remaps = new Map<string, OriginTemporalRemap>();
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.timeline);
  const outputFrameCount = resolveTemporalOutputFrameCount(state, targetGroupId);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    outputFrameCount,
  );

  for (const originId of buildTargetOriginIds(state.timeline, targetGroupId)) {
    const timelineState = state.timelineStateByOriginId.get(originId);
    const sourceWindow = resolveSourceWindow(
      originId,
      state.timelineStateByOriginId,
      occupiedWindowByOriginId,
    );
    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      continue;
    }

    const outputWindow = timelineState?.authored === true
      ? timelineState.window
      : {
          start: 0,
          end: sourceSpan,
        };
    const outputSpan = outputWindow.end - outputWindow.start;
    if (!Number.isFinite(outputSpan) || outputSpan <= 0) {
      continue;
    }

    const sourceFrameIndexByOutputFrame: Array<number | null> = Array.from(
      { length: outputFrameCount },
      (_, frameIndex) => {
        if (!isFrameWithinWindow(frameIndex, frameWindow)) {
          return null;
        }

        const outputBeat = frameIndex * state.timeline.sampleStepBeats;
        if (outputBeat < outputWindow.start || outputBeat >= outputWindow.end) {
          return null;
        }

        const normalizedEnd = Math.min(
          Math.max(((outputBeat + state.timeline.sampleStepBeats) - outputWindow.start) / outputSpan, 0),
          1,
        );
        return toSourceFrameIndex(
          sourceWindow.start + sourceSpan * (1 - normalizedEnd),
          state.timeline,
        );
      },
    );
    if (!hasMappedSourceFrame(sourceFrameIndexByOutputFrame)) {
      continue;
    }

    remaps.set(originId, {
      nextTimelineAuthored: timelineState?.authored === true,
      sourceFrameIndexByOutputFrame,
    });
  }

  return remaps;
};

const buildTrimRemaps = (
  state: MutableGenerationState,
  effect: TrimEffectNode,
  targetGroupId: string | null,
  modulationContext: ModulationContext,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, OriginTemporalRemap> => {
  const remaps = new Map<string, OriginTemporalRemap>();
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.timeline);
  const outputFrameCount = resolveTemporalOutputFrameCount(state, targetGroupId);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    outputFrameCount,
  );

  for (const originId of buildTargetOriginIds(state.timeline, targetGroupId)) {
    const timelineState = state.timelineStateByOriginId.get(originId);
    const sourceWindow = resolveSourceWindow(
      originId,
      state.timelineStateByOriginId,
      occupiedWindowByOriginId,
    );
    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      continue;
    }

    const outputWindow = timelineState?.authored === true
      ? timelineState.window
      : DEFAULT_TIMELINE_WINDOW;
    const outputSpan = outputWindow.end - outputWindow.start;
    if (!Number.isFinite(outputSpan) || outputSpan <= 0) {
      continue;
    }

    const sourceFrameIndexByOutputFrame: Array<number | null> = Array.from(
      { length: outputFrameCount },
      (_, frameIndex) => {
        if (!isFrameWithinWindow(frameIndex, frameWindow)) {
          return null;
        }

        const outputBeat = frameIndex * state.timeline.sampleStepBeats;
        if (outputBeat < outputWindow.start || outputBeat >= outputWindow.end) {
          return null;
        }

        const deviceAtFrame = resolveModulatedDeviceAtFrame(
          modulationContext,
          effect,
          frameIndex,
          state.timeline.sampleStepBeats,
        );
        const start = deviceAtFrame.params.start;
        const end = deviceAtFrame.params.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end <= start) {
          return null;
        }

        const normalized = (outputBeat - outputWindow.start) / outputSpan;
        return toSourceFrameIndex(
          sourceWindow.start + sourceSpan * (start + normalized * (end - start)),
          state.timeline,
        );
      },
    );
    if (!hasMappedSourceFrame(sourceFrameIndexByOutputFrame)) {
      continue;
    }

    remaps.set(originId, {
      nextTimelineAuthored: true,
      sourceFrameIndexByOutputFrame,
    });
  }

  return remaps;
};

const buildStretchRemaps = (
  state: MutableGenerationState,
  effect: StretchEffectNode,
  targetGroupId: string | null,
  modulationContext: ModulationContext,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, OriginTemporalRemap> => {
  const remaps = new Map<string, OriginTemporalRemap>();
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.timeline);
  const outputFrameCount = resolveTemporalOutputFrameCount(state, targetGroupId);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    outputFrameCount,
  );

  for (const originId of buildTargetOriginIds(state.timeline, targetGroupId)) {
    const sourceWindow = resolveSourceWindow(
      originId,
      state.timelineStateByOriginId,
      occupiedWindowByOriginId,
    );
    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      continue;
    }

    const sourceFrameIndexByOutputFrame: Array<number | null> = Array.from(
      { length: outputFrameCount },
      (_, frameIndex) => {
        if (!isFrameWithinWindow(frameIndex, frameWindow)) {
          return null;
        }

        const outputBeat = frameIndex * state.timeline.sampleStepBeats;
        const deviceAtFrame = resolveModulatedDeviceAtFrame(
          modulationContext,
          effect,
          frameIndex,
          state.timeline.sampleStepBeats,
        );
        const start = deviceAtFrame.params.start;
        const end = deviceAtFrame.params.end;
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end <= start) {
          return null;
        }

        if (outputBeat < start || outputBeat >= end) {
          return null;
        }

        const normalized = (outputBeat - start) / (end - start);
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
      nextTimelineAuthored: true,
      sourceFrameIndexByOutputFrame,
    });
  }

  return remaps;
};

const buildTimeWarpRemaps = (
  state: MutableGenerationState,
  effect: TimeWarpEffectNode,
  targetGroupId: string | null,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, OriginTemporalRemap> => {
  const remaps = new Map<string, OriginTemporalRemap>();
  if (isIdentityTimeWarpCurve(effect.params.curve)) {
    return remaps;
  }

  const remap = createSampledRemapFromTimeWarpCurve(effect.params.curve);
  const occupiedWindowByOriginId = buildOccupiedWindowByOriginId(state.timeline);
  const outputFrameCount = resolveTemporalOutputFrameCount(state, targetGroupId);
  const frameWindow = resolveFrameWindow(
    requiredFrameWindow,
    state.timeline.sampleStepBeats,
    outputFrameCount,
  );

  for (const originId of buildTargetOriginIds(state.timeline, targetGroupId)) {
    const timelineState = state.timelineStateByOriginId.get(originId);
    const sourceWindow = resolveSourceWindow(
      originId,
      state.timelineStateByOriginId,
      occupiedWindowByOriginId,
    );
    const sourceSpan = sourceWindow.end - sourceWindow.start;
    if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
      continue;
    }

    const outputWindow = timelineState?.authored === true
      ? timelineState.window
      : DEFAULT_TIMELINE_WINDOW;
    const outputSpan = outputWindow.end - outputWindow.start;
    if (!Number.isFinite(outputSpan) || outputSpan <= 0) {
      continue;
    }

    const sourceFrameIndexByOutputFrame: Array<number | null> = Array.from(
      { length: outputFrameCount },
      (_, frameIndex) => {
        if (!isFrameWithinWindow(frameIndex, frameWindow)) {
          return null;
        }

        const outputBeat = frameIndex * state.timeline.sampleStepBeats;
        if (outputBeat < outputWindow.start || outputBeat >= outputWindow.end) {
          return null;
        }

        const normalized = (outputBeat - outputWindow.start) / outputSpan;
        const remappedBeat = evaluateTemporalRemap(remap, normalized);
        if (remappedBeat === null || !Number.isFinite(remappedBeat)) {
          return null;
        }

        return toSourceFrameIndex(
          sourceWindow.start + sourceSpan * remappedBeat,
          state.timeline,
        );
      },
    );
    if (!hasMappedSourceFrame(sourceFrameIndexByOutputFrame)) {
      continue;
    }

    remaps.set(originId, {
      nextTimelineAuthored: true,
      sourceFrameIndexByOutputFrame,
    });
  }

  return remaps;
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
  spatialAdapter: CanonicalSpatialAdapter,
  targetGroupId: string | null,
  frameIndex: number,
): GeometryMask => {
  if (effect.params.sourceKind === 'tiles') {
    const mask = spatialAdapter.createMaskFromViewportTiles(effect.params.tiles);
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
  spatialAdapter: CanonicalSpatialAdapter,
  executionPlan: OperatorExecutionPlan,
): MutableGenerationState => {
  const sourceTimeline = state.timeline;
  const nextTimeline = createEmptyTimeline(state.timeline.sampleStepBeats, state.timeline.timeDomainEndBeat);
  nextTimeline.nextWriteId = state.timeline.nextWriteId;
  ensureTimelineFrameCount(nextTimeline, state.timeline.timeDomainEndBeat);
  const targetFrameWindow = resolveFrameWindow(
    executionPlan.requiredFrameWindow,
    state.timeline.sampleStepBeats,
    sourceTimeline.frames.length,
  );

  for (let frameIndex = 0; frameIndex < sourceTimeline.frames.length; frameIndex += 1) {
    const mask = resolveMaskSourceMask(
      sourceTimeline,
      chain,
      effect,
      consumingDeviceIndex,
      spatialAdapter,
      targetGroupId,
      frameIndex,
    );

    for (const stroke of sourceTimeline.frames[frameIndex].strokes) {
      if (!isTargetedStroke(stroke, targetGroupId)) {
        nextTimeline.frames[frameIndex].strokes.push(cloneStroke(stroke));
        continue;
      }

      if (!isFrameWithinWindow(frameIndex, targetFrameWindow)) {
        continue;
      }

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
  }

  return {
    timeline: finalizeTimeline(nextTimeline),
    timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
  };
};

const groupActivationSegmentsByOriginId = (
  segments: ReadonlyArray<GeometryActivationSegment>,
): Map<string, GeometryActivationSegment[]> => {
  const segmentsByOriginId = new Map<string, GeometryActivationSegment[]>();

  for (const segment of segments) {
    const existingSegments = segmentsByOriginId.get(segment.originId);
    if (existingSegments) {
      existingSegments.push(segment);
      continue;
    }

    segmentsByOriginId.set(segment.originId, [segment]);
  }

  return segmentsByOriginId;
};

const applyColorEffect = (
  state: MutableGenerationState,
  effect: ColorEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
): MutableGenerationState => {
  const nextTimeline = createEmptyTimeline(state.timeline.sampleStepBeats, state.timeline.timeDomainEndBeat);
  nextTimeline.nextWriteId = state.timeline.nextWriteId;
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

  for (let frameIndex = 0; frameIndex < state.timeline.frames.length; frameIndex += 1) {
    for (const stroke of state.timeline.frames[frameIndex].strokes) {
      if (isTargetedStroke(stroke, targetGroupId)) {
        continue;
      }

      nextTimeline.frames[frameIndex].strokes.push(cloneStroke(stroke));
    }
  }

  for (const [originId, sourceSegments] of targetSegmentsByOriginId.entries()) {
    const slots = planColorProgramSlots(sourceSegments, colorConfig);
    if (slots.length === 0) {
      continue;
    }

    for (const slot of slots) {
      ensureTimelineFrameCount(nextTimeline, slot.endBeat);
      const startFrame = Math.max(Math.floor(slot.startBeat / nextTimeline.sampleStepBeats), 0);
      const endFrameExclusive = Math.min(
        Math.ceil(slot.endBeat / nextTimeline.sampleStepBeats),
        nextTimeline.frames.length,
      );

      for (let frameIndex = startFrame; frameIndex < endFrameExclusive; frameIndex += 1) {
        if (!isFrameWithinWindow(frameIndex, frameWindow)) {
          continue;
        }

        addStrokeToFrame(nextTimeline, frameIndex, {
          polyline: {
            points: [{ x: slot.source.x, y: slot.source.y }],
            closed: false,
            originId,
            velocity: slot.velocity,
            clipStack: [],
          },
          originGroupId: slot.source.originGroupId,
          writeOrder,
        });
      }
    }
  }

  return {
    timeline: finalizeTimeline(nextTimeline),
    timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
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

const cloneGenerationState = (
  state: MutableGenerationState,
): MutableGenerationState => ({
  timeline: cloneTimeline(state.timeline),
  timelineStateByOriginId: cloneTimelineStateByOriginId(state.timelineStateByOriginId),
});

const isGeneratorStage = (
  stage: CompiledRackStage,
): boolean => stage.deviceKind === 'waterdrop'
  || stage.deviceKind === 'scanner'
  || stage.deviceKind === 'spiral'
  || stage.deviceKind === 'path';

const applyEffectDevice = (
  state: MutableGenerationState,
  chain: GeneratorChain,
  stage: CompiledRackStage,
  spatialAdapter: CanonicalSpatialAdapter,
  modulationContext: ModulationContext,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
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
      spatialAdapter,
      executionPlan,
    );
  }

  if (device.kind === 'color') {
    return applyColorEffect(
      state,
      device,
      targetGroupId,
      deviceIndex,
      executionPlan.requiredFrameWindow,
    );
  }

  if (device.kind === 'symmetry') {
    return applySymmetryEffect(
      state,
      device,
      targetGroupId,
      deviceIndex,
      executionPlan.requiredFrameWindow,
    );
  }

  if (device.kind === 'reverse') {
    const remaps = buildReverseRemaps(state, targetGroupId, executionPlan.requiredFrameWindow);
    return remaps.size > 0
      ? applyTemporalRemap(state, targetGroupId, remaps, deviceIndex, executionPlan.requiredFrameWindow)
      : cloneGenerationState(state);
  }

  if (device.kind === 'trim') {
    const remaps = buildTrimRemaps(
      state,
      device,
      targetGroupId,
      modulationContext,
      executionPlan.requiredFrameWindow,
    );
    return remaps.size > 0
      ? applyTemporalRemap(state, targetGroupId, remaps, deviceIndex, executionPlan.requiredFrameWindow)
      : cloneGenerationState(state);
  }

  if (device.kind === 'stretch') {
    const remaps = buildStretchRemaps(
      state,
      device,
      targetGroupId,
      modulationContext,
      executionPlan.requiredFrameWindow,
    );
    return remaps.size > 0
      ? applyTemporalRemap(state, targetGroupId, remaps, deviceIndex, executionPlan.requiredFrameWindow)
      : cloneGenerationState(state);
  }

  if (device.kind === 'timewarp') {
    const remaps = buildTimeWarpRemaps(
      state,
      device,
      targetGroupId,
      executionPlan.requiredFrameWindow,
    );
    return remaps.size > 0
      ? applyTemporalRemap(state, targetGroupId, remaps, deviceIndex, executionPlan.requiredFrameWindow)
      : cloneGenerationState(state);
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
  );
};

const applyGeneratorDevice = (
  state: MutableGenerationState,
  stage: CompiledRackStage,
  modulationContext: ModulationContext,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
): MutableGenerationState => {
  const device = stage.device as GeneratorNode;
  const deviceIndex = stage.stageIndex;
  const nextTimeline = cloneTimeline(state.timeline);
  nextTimeline.nextWriteId = state.timeline.nextWriteId;
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

  const nextTimelineStateByOriginId = cloneTimelineStateByOriginId(state.timelineStateByOriginId);
  nextTimelineStateByOriginId.set(device.id, {
    authored: false,
    window: DEFAULT_TIMELINE_WINDOW,
  });

  return {
    timeline: finalizeTimeline(nextTimeline),
    timelineStateByOriginId: nextTimelineStateByOriginId,
  };
};

const applyCompiledRackStage = (
  state: MutableGenerationState,
  compiledPlan: CompiledRackPlan,
  stage: CompiledRackStage,
  spatialAdapter: CanonicalSpatialAdapter,
  modulationContext: ModulationContext,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
): MutableGenerationState => isGeneratorStage(stage)
  ? applyGeneratorDevice(
      state,
      stage,
      modulationContext,
      executionPlanByDeviceId,
    )
  : applyEffectDevice(
      state,
      compiledPlan.baseChain,
      stage,
      spatialAdapter,
      modulationContext,
      executionPlanByDeviceId,
    );

const executeCompiledRackPlan = (
  compiledPlan: CompiledRackPlan,
  loopLengthBeats: number,
  spatialAdapter: CanonicalSpatialAdapter,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
): MutableGenerationState => {
  const modulationContext = createModulationContext(compiledPlan.baseChain, loopLengthBeats);
  let currentState: MutableGenerationState = {
    timeline: createEmptyTimeline(),
    timelineStateByOriginId: new Map<string, OriginTimelineState>(),
  };

  for (const stage of compiledPlan.stages) {
    currentState = applyCompiledRackStage(
      currentState,
      compiledPlan,
      stage,
      spatialAdapter,
      modulationContext,
      executionPlanByDeviceId,
    );
  }

  return currentState;
};

export const buildCanonicalFieldResult = (
  chain: GeneratorChain,
  loopLengthBeats: number,
  spatialAdapter: CanonicalSpatialAdapter,
  executionRequest: CanonicalExecutionRequest,
): CanonicalFieldResult => {
  const compiledPlan = buildCompiledRackPlan(chain, loopLengthBeats);
  const executionPlan = buildCanonicalExecutionPlan(compiledPlan.baseChain, executionRequest);
  const executionState = executeCompiledRackPlan(
    compiledPlan,
    loopLengthBeats,
    spatialAdapter,
    executionPlan.byDeviceId,
  );
  const timeline = finalizeTimeline(executionState.timeline);
  const { mutedGroupIds, mutedGeneratorIds } = resolveMutedSources(compiledPlan.baseChain);

  return {
    loopLengthBeats,
    timeline,
    sourceTimelineEndBeat: timeline.timeDomainEndBeat,
    sampleStepBeats: timeline.sampleStepBeats,
    mutedGroupIds,
    mutedGeneratorIds,
    analysis: compiledPlan.analysis,
    executionPlan,
    compiledPlan,
  };
};
