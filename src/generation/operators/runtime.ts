import {
  applyTransformToPolyline,
  invertAffine,
  toTranslationTransform,
} from '../../core/geometry';
import {
  applyModulationProgramToChain,
  compileModulationProgram,
  type CompiledModulationProgram,
} from '../../core/modulation/compiled-program';
import type { SceneTemporalState } from '../../core/core-types';
import {
  cloneSceneTemporalState,
  createIdentitySceneTemporalState,
  evaluateTemporalRemap,
} from '../../core/scene-operators/temporal';
import type { TimedColorSource } from '../../devices/color/color-program';
import {
  cloneDeviceNode,
  isGeneratorDeviceKind,
  isGeneratorNode,
  type GeneratorChain,
  type GeneratorDeviceNode,
  type GeneratorEffectNode,
  type GeneratorNode,
} from '../../shared/model';
import { normalizeOptionalId } from '../../shared/normalize-id';
import {
  clonePendingTemporalWriteOrderByOriginId,
  cloneSealedOriginIds,
  cloneTimelineStateByOriginId,
  type MutableGenerationState,
  type OriginTimelineState,
} from '../timeline/state';
import {
  clampSceneTemporalStateToFixedLoop,
  cloneTimelineWindow,
  createMaterializedTemporalState,
  EMPTY_TIMELINE_WINDOW,
  FIXED_TIMELINE_END_BEAT,
  hasPendingTemporalState,
  isFixedTimelineWindow,
  isWindowEmpty,
  resolveTemporalPlacementWindow,
  TIMELINE_WINDOW_EPSILON,
  type TimelineWindow,
} from '../timeline/temporal-window';
import type {
  CompiledRackPlan,
  CompiledRackStage,
  RackStageDeviceKind,
  RackStageDeviceNode,
} from '../plan/types';
import type {
  BeatRange,
  OperatorExecutionPlan,
  SpatialRequirement,
} from '../analysis/types';
import {
  collectOccupiedCoordinates,
} from '../timeline/analysis';
import {
  addExistingStrokeToFrame,
  addStrokeToFrame,
  beginTimelineStage,
  completeTimelineStage,
  setFrameStrokes,
  toFrameCount,
  toFrameWindow,
  type FrameWindow,
} from '../timeline';
import type {
  CanonicalOutputAdapter,
  GeometryMask,
  GeometryStroke,
  GeometryTimeline,
} from '../types';

export interface ModulationContext {
  loopLengthBeats: number;
  program: CompiledModulationProgram;
  deviceByFrameKey: Map<string, GeneratorDeviceNode>;
}

export interface MaskSourceReferenceContext {
  compiledPlan: CompiledRackPlan;
  outputAdapter: CanonicalOutputAdapter;
  modulationContext: ModulationContext;
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>;
  mutedGroupIds: ReadonlySet<string>;
  mutedGeneratorIds: ReadonlySet<string>;
  timelineBySourceKey: Map<string, GeometryTimeline>;
  resolvingSourceKeys: Set<string>;
  resolveReferenceTimeline(sourceKind: 'group' | 'generator', sourceId: string): GeometryTimeline | null;
}

export interface RackStageExecutionContext {
  compiledPlan: CompiledRackPlan;
  outputAdapter: CanonicalOutputAdapter;
  modulationContext: ModulationContext;
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>;
  mutedGroupIds: ReadonlySet<string>;
  mutedGeneratorIds: ReadonlySet<string>;
  referenceContext: MaskSourceReferenceContext;
}

export type RackOperatorInputPreparation = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
) => MutableGenerationState;

export interface RackOperator {
  prepareInput: RackOperatorInputPreparation;
  execute(
    state: MutableGenerationState,
    stage: CompiledRackStage,
    context: RackStageExecutionContext,
  ): MutableGenerationState;
}

export type RackStageOfKind<TKind extends RackStageDeviceKind> = CompiledRackStage & {
  deviceKind: TKind;
  device: Extract<RackStageDeviceNode, { kind: TKind }>;
};

export type GeneratorStageKind = GeneratorNode['kind'];
export type SpatialTransformStageKind = Extract<GeneratorEffectNode['kind'], 'mirror' | 'rotate' | 'translate' | 'scale'>;

export const createRackOperator = <TKind extends RackStageDeviceKind>(
  prepareInput: RackOperatorInputPreparation,
  execute: (
    state: MutableGenerationState,
    stage: RackStageOfKind<TKind>,
    context: RackStageExecutionContext,
  ) => MutableGenerationState,
): RackOperator => ({
  prepareInput,
  execute: (state, stage, context) => execute(
    state,
    stage as RackStageOfKind<TKind>,
    context,
  ),
});

export interface OriginFrameRemap {
  nextTemporal: SceneTemporalState;
  sourceFrameIndexByOutputFrame: ReadonlyArray<number | null>;
  writeOrder: number;
}

const FULL_EXECUTION_BOUNDS: SpatialRequirement = 'all';
const EMPTY_EXECUTION_PLAN: OperatorExecutionPlan = Object.freeze({
  requiredOutputBounds: FULL_EXECUTION_BOUNDS,
  generatorOutputBounds: FULL_EXECUTION_BOUNDS,
  requiredInputRoi: FULL_EXECUTION_BOUNDS,
  requiredSourceRoi: 'none',
  requiredFrameWindow: 'all',
  requiredSourceFrameWindow: 'none',
});

export const resolveStageExecutionPlan = (
  context: RackStageExecutionContext,
  stage: CompiledRackStage,
): OperatorExecutionPlan => context.executionPlanByDeviceId.get(stage.deviceId) ?? EMPTY_EXECUTION_PLAN;

export const resolveFrameWindow = (
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

export const isFrameWithinWindow = (
  frameIndex: number,
  window: FrameWindow,
): boolean => frameIndex >= window.startFrame && frameIndex < window.endFrameExclusive;

export const createModulationContext = (
  modulationChain: GeneratorChain,
  loopLengthBeats: number,
): ModulationContext => ({
  loopLengthBeats,
  program: compileModulationProgram(modulationChain),
  deviceByFrameKey: new Map<string, GeneratorDeviceNode>(),
});

export const resolveModulatedDeviceAtFrame = <T extends GeneratorDeviceNode>(
  context: ModulationContext,
  device: T,
  frameIndex: number,
  sampleStepBeats: number,
  evaluationLoopLengthBeats = context.loopLengthBeats,
): T => {
  if (context.program.routes.length === 0) {
    return device;
  }

  const cacheKey = `${device.id}:${frameIndex}:${evaluationLoopLengthBeats}`;
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
    evaluationLoopLengthBeats,
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

export const forEachTargetedFrame = (
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

export const buildTargetOriginIds = (
  timeline: GeometryTimeline,
  targetGroupId: string | null,
  options: {
    excludeMutedSources?: boolean;
    mutedGroupIds?: ReadonlySet<string>;
    mutedGeneratorIds?: ReadonlySet<string>;
  } = {},
): Set<string> => {
  const originIds = new Set<string>();
  const excludeMutedSources = options.excludeMutedSources === true;
  const mutedGroupIds = options.mutedGroupIds ?? new Set<string>();
  const mutedGeneratorIds = options.mutedGeneratorIds ?? new Set<string>();

  for (const frame of timeline.frames) {
    for (const stroke of frame.strokes) {
      if (!isTargetedStroke(stroke, targetGroupId)) {
        continue;
      }

      if (
        excludeMutedSources
        && (
          mutedGeneratorIds.has(stroke.polyline.originId)
          || (stroke.originGroupId !== null && mutedGroupIds.has(stroke.originGroupId))
        )
      ) {
        continue;
      }

      originIds.add(stroke.polyline.originId);
    }
  }

  return originIds;
};

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

export const buildTimelineStateByOriginId = (
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

export const cloneMask = (
  mask: GeometryMask,
): GeometryMask => ({
  contains: mask.contains,
  inverseTransform: { ...mask.inverseTransform },
});

const resolveIntraWriteOrder = (
  writeOrder: number,
): number => {
  if (!Number.isFinite(writeOrder)) {
    return 0;
  }

  const baseOrder = Math.trunc(writeOrder);
  return writeOrder - baseOrder;
};

const resolveStageWriteOrder = (
  writeOrder: number,
  stroke: GeometryStroke,
): number => writeOrder + resolveIntraWriteOrder(stroke.writeOrder);

export const resolveColorSlotWriteOrder = (
  writeOrder: number,
  slotIndex: number,
  slotCount: number,
): number => writeOrder + ((Math.max(slotCount, 1) - slotIndex) / (Math.max(slotCount, 1) + 1));

export const resolveColorSlotDestinationFrameIndexes = <T extends TimedColorSource>(
  source: T,
  startFrameIndex: number,
  destinationFrameWindow: FrameWindow,
  timelineFrameCount: number,
  shouldWrap: boolean,
): number[] => {
  if (shouldWrap) {
    return [wrapFrameIndex(startFrameIndex, timelineFrameCount)];
  }

  if (source.referenceDuration === undefined) {
    return [startFrameIndex];
  }

  const frameIndexes: number[] = [];
  for (
    let frameIndex = Math.max(destinationFrameWindow.startFrame, startFrameIndex);
    frameIndex < destinationFrameWindow.endFrameExclusive;
    frameIndex += 1
  ) {
    frameIndexes.push(frameIndex);
  }

  return frameIndexes;
};

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

export const cloneStrokeWithWriteOrder = (
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
  writeOrder: resolveStageWriteOrder(writeOrder, stroke),
  masks: stroke.masks.map(cloneMask),
});

export const cloneStrokeWithVelocityAndWriteOrder = (
  stroke: GeometryStroke,
  velocity: number,
  writeOrder: number,
  colorSlotIndex: number,
  colorSlotCount: number,
  colorSlotGapFill: boolean,
): Omit<GeometryStroke, 'writeId'> => ({
  polyline: {
    ...stroke.polyline,
    velocity,
    colorSlotIndex,
    colorSlotCount,
    colorSlotGapFill,
    points: stroke.polyline.points,
    clipStack: stroke.polyline.clipStack,
  },
  originGroupId: stroke.originGroupId,
  writeOrder,
  masks: stroke.masks.map(cloneMask),
});

const resolveStrokeActivationSignature = (
  stroke: Omit<GeometryStroke, 'writeId'>,
): string | undefined => {
  const coordinates = collectOccupiedCoordinates([
    {
      ...stroke,
      writeId: 0,
    },
  ], true);
  const signature = Array.from(coordinates.values())
    .map((coordinate) => `${coordinate.x},${coordinate.y}`)
    .sort()
    .join('|');
  return signature || undefined;
};

export const transformStroke = (
  stroke: GeometryStroke,
  transform: ReturnType<typeof toTranslationTransform> | null,
  writeOrder: number,
): Omit<GeometryStroke, 'writeId'> => {
  const polyline = transform
    ? applyTransformToPolyline(stroke.polyline, transform)
    : {
        ...stroke.polyline,
        points: stroke.polyline.points.map((point) => ({ ...point })),
        clipStack: stroke.polyline.clipStack.map((clip) => ({
          ...clip,
            inverseTransform: { ...clip.inverseTransform },
          })),
      };
  const transformedStroke = {
    polyline,
    originGroupId: stroke.originGroupId,
    writeOrder: resolveStageWriteOrder(writeOrder, stroke),
    masks: stroke.masks.map((mask) => transformMask(mask, transform)),
  };

  return {
    ...transformedStroke,
    polyline: {
      ...polyline,
      activationSignature: resolveStrokeActivationSignature(transformedStroke),
    },
  };
};

export const buildSourceStrokesByOriginAndFrame = (
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

export const stripOriginFrames = (
  timeline: GeometryTimeline,
  sourceFrameCount: number,
  targetOriginIds: ReadonlySet<string>,
): void => {
  for (let frameIndex = 0; frameIndex < sourceFrameCount; frameIndex += 1) {
    takeOriginStrokesFromFrame(timeline, frameIndex, targetOriginIds);
  }
};

export const toSourceFrameIndex = (
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

export const applyTemporalStateUpdates = (
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
    sealedOriginIds: cloneSealedOriginIds(state.sealedOriginIds),
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
      || state.sealedOriginIds.has(originId)
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

    const placementWindow = resolveTemporalPlacementWindow(timelineState);
    const placementSpan = placementWindow.end - placementWindow.start;
    const sourceFrameIndexByOutputFrame: Array<number | null> = !Number.isFinite(placementSpan) || placementSpan <= 0
      ? Array.from({ length: outputFrameCount }, (): number | null => null)
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

export const materializePendingTemporalState = (
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
    sealedOriginIds: cloneSealedOriginIds(state.sealedOriginIds),
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

export const sealStageWithTemporalInvariant = (
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

  const timelineStateByOriginId = buildTimelineStateByOriginId(
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
  );

  return {
    timeline: nextTimeline,
    timelineStateByOriginId,
    pendingTemporalWriteOrderByOriginId: normalizeRemaps.size > 0
      ? new Map<string, number>()
      : clonePendingTemporalWriteOrderByOriginId(state.pendingTemporalWriteOrderByOriginId),
    sealedOriginIds: new Set(timelineStateByOriginId.keys()),
  };
};

export const materializeRackOperatorInput: RackOperatorInputPreparation = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): MutableGenerationState => materializePendingTemporalState(
  state,
  context.outputAdapter,
  context.mutedGroupIds,
  context.mutedGeneratorIds,
);

export const sealRackState = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): MutableGenerationState => sealStageWithTemporalInvariant(
  state,
  context.outputAdapter,
  context.mutedGroupIds,
  context.mutedGeneratorIds,
);

export const materializeAndSealRackState = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): MutableGenerationState => sealRackState(
  materializeRackOperatorInput(state, context),
  context,
);

export const prepareTemporalRackOperatorInput: RackOperatorInputPreparation = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
): MutableGenerationState => (
  state.timeline.timeDomainEndBeat <= FIXED_TIMELINE_END_BEAT + TIMELINE_WINDOW_EPSILON
    ? state
    : materializeAndSealRackState(state, context)
);

export const sealRackOperatorInput: RackOperatorInputPreparation = materializeAndSealRackState;

export const createRackStageExecutionContext = (
  referenceContext: MaskSourceReferenceContext,
): RackStageExecutionContext => ({
  compiledPlan: referenceContext.compiledPlan,
  outputAdapter: referenceContext.outputAdapter,
  modulationContext: referenceContext.modulationContext,
  executionPlanByDeviceId: referenceContext.executionPlanByDeviceId,
  mutedGroupIds: referenceContext.mutedGroupIds,
  mutedGeneratorIds: referenceContext.mutedGeneratorIds,
  referenceContext,
});

export const isGeneratorStage = (
  stage: CompiledRackStage,
): stage is RackStageOfKind<GeneratorStageKind> => isGeneratorDeviceKind(stage.deviceKind);

const isReferenceGeneratorStage = (
  stage: CompiledRackStage,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): boolean => {
  if (!isGeneratorStage(stage)) {
    return false;
  }

  return sourceKind === 'group'
    ? stage.groupId === sourceId
    : stage.deviceId === sourceId;
};

export const resolveGeneratorGroupId = (
  chain: GeneratorChain,
  generatorId: string,
): string | null | undefined => {
  const generator = chain.devices.find((device) => (
    device.id === generatorId
    && isGeneratorNode(device)
  ));

  return generator ? normalizeOptionalId(generator.groupId) : undefined;
};

const isReferenceEffectStage = (
  stage: CompiledRackStage,
  context: MaskSourceReferenceContext,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): boolean => {
  if (isGeneratorStage(stage)) {
    return false;
  }

  if (sourceKind === 'group') {
    return stage.groupId === sourceId;
  }

  const sourceGroupId = resolveGeneratorGroupId(context.compiledPlan.baseChain, sourceId);
  if (sourceGroupId === undefined) {
    return false;
  }

  return stage.groupId === sourceGroupId;
};

export const shouldApplyReferenceStage = (
  stage: CompiledRackStage,
  context: MaskSourceReferenceContext,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): boolean => isReferenceGeneratorStage(stage, sourceKind, sourceId)
  || isReferenceEffectStage(stage, context, sourceKind, sourceId);

export const resolveMaskReferenceMutedGroupIds = (
  context: MaskSourceReferenceContext,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): Set<string> => {
  const mutedGroupIds = new Set(context.mutedGroupIds);
  if (sourceKind === 'group') {
    mutedGroupIds.delete(sourceId);
    return mutedGroupIds;
  }

  const sourceGroupId = resolveGeneratorGroupId(context.compiledPlan.baseChain, sourceId);
  if (sourceGroupId) {
    mutedGroupIds.delete(sourceGroupId);
  }
  return mutedGroupIds;
};

export const resolveMaskReferenceMutedGeneratorIds = (
  context: MaskSourceReferenceContext,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): Set<string> => {
  const mutedGeneratorIds = new Set(context.mutedGeneratorIds);
  if (sourceKind === 'generator') {
    mutedGeneratorIds.delete(sourceId);
  }
  return mutedGeneratorIds;
};
