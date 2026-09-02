import { evaluateTemporalRemap } from '../../core/scene-operators/temporal';
import { createSampledRemapFromTimeWarpCurve, isIdentityTimeWarpCurve } from '../../core/timewarp/curve';
import type {
  GeneratorEffectNode,
  StretchEffectNode,
  TimeWarpEffectNode,
  TrimEffectNode,
} from '../../shared/model';
import { toFrameCount, toFrameWindow } from '../timeline';
import { DEFAULT_TIMELINE_WINDOW } from '../timeline/temporal-window';
import type { MaterializedGenerationState } from '../timeline/state';
import type { GeometryTimeline } from '../types';
import {
  buildTargetOriginIds,
  createRackOperator,
  replaceTimelineAndRefreshRackState,
  resolveModulatedDeviceAtFrame,
  type ModulationContext,
  type RackStageExecutionContext,
} from './runtime';
import { remapTimeline } from './runtime/frame-remap';
import {
  buildFixedTimelineStateOverrides,
  resolveCanonicalSourceWindow,
} from './runtime/timeline-state';
import type { OriginFrameRemap } from './runtime/types';

interface SourceFrameSelection {
  start: number;
  end: number;
  progress: number;
}

type SourceSelectionResolver = (
  outputProgress: number,
  outputFrameIndex: number,
) => SourceFrameSelection | null;

const resolveOutputProgress = (
  frameIndex: number,
  frameCount: number,
): number => frameCount <= 1 ? 0 : frameIndex / (frameCount - 1);

const buildFixedDomainFrameIndexes = (
  timeline: GeometryTimeline,
  sourceWindow: { start: number; end: number },
  resolveSourceSelection: SourceSelectionResolver,
): Array<number | null> => {
  const sourceFrameWindow = toFrameWindow(
    sourceWindow,
    timeline.sampleStepBeats,
    timeline.frames.length,
  );
  const sourceFrameCount = sourceFrameWindow.endFrameExclusive - sourceFrameWindow.startFrame;
  const outputFrameCount = toFrameCount(1, timeline.sampleStepBeats);
  if (sourceFrameCount <= 0) {
    return Array.from({ length: outputFrameCount }, (): number | null => null);
  }

  return Array.from({ length: outputFrameCount }, (_, outputFrameIndex) => {
    const outputProgress = resolveOutputProgress(outputFrameIndex, outputFrameCount);
    const selection = resolveSourceSelection(outputProgress, outputFrameIndex);
    if (
      !selection
      || !Number.isFinite(selection.start)
      || !Number.isFinite(selection.end)
      || !Number.isFinite(selection.progress)
      || selection.start < 0
      || selection.end > 1
      || selection.end <= selection.start
      || selection.progress < 0
      || selection.progress > 1
    ) {
      return null;
    }

    const selectedStartOffset = Math.min(
      Math.max(Math.floor(selection.start * sourceFrameCount), 0),
      sourceFrameCount,
    );
    const selectedEndOffset = Math.min(
      Math.max(Math.ceil(selection.end * sourceFrameCount), selectedStartOffset),
      sourceFrameCount,
    );
    const selectedFrameCount = selectedEndOffset - selectedStartOffset;
    if (selectedFrameCount <= 0) {
      return null;
    }

    return sourceFrameWindow.startFrame
      + selectedStartOffset
      + Math.round(selection.progress * Math.max(selectedFrameCount - 1, 0));
  });
};

const resolveTemporalStageEndBeat = (
  timeline: GeometryTimeline,
  targetOriginIds: ReadonlySet<string>,
): number => Array.from(timeline.originGroupIdByOriginId.keys()).some(
  (originId) => !targetOriginIds.has(originId),
)
  ? Math.max(timeline.timeDomainEndBeat, 1)
  : 1;

const applyFixedDomainTemporalTransform = (
  state: MaterializedGenerationState,
  targetGroupId: string | null,
  writeOrder: number,
  resolveSourceSelection: SourceSelectionResolver,
  context: RackStageExecutionContext,
): MaterializedGenerationState => {
  const targetOriginIds = buildTargetOriginIds(state.timeline, targetGroupId);
  if (targetOriginIds.size === 0) {
    return state;
  }

  const originRemaps = new Map<string, OriginFrameRemap>();
  for (const originId of targetOriginIds) {
    const timelineState = state.timelineStateByOriginId.get(originId);
    if (!timelineState) {
      continue;
    }

    originRemaps.set(originId, {
      sourceFrameIndexByOutputFrame: buildFixedDomainFrameIndexes(
        state.timeline,
        resolveCanonicalSourceWindow(timelineState),
        resolveSourceSelection,
      ),
      writeOrder,
    });
  }

  const timeline = remapTimeline(
    state.timeline,
    originRemaps,
    'all',
    resolveTemporalStageEndBeat(state.timeline, targetOriginIds),
    false,
  );
  return replaceTimelineAndRefreshRackState(
    state,
    timeline,
    state.timelineStateByOriginId,
    context,
    buildFixedTimelineStateOverrides(originRemaps.keys()),
  ) as MaterializedGenerationState;
};

const resolveWindowSourceProgress = (
  outputFrameIndex: number,
  outputFrameCount: number,
  sampleStepBeats: number,
  start: number,
  end: number,
): number | null => {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end <= start) {
    return null;
  }
  const frameWindow = toFrameWindow({ start, end }, sampleStepBeats, outputFrameCount);
  if (
    outputFrameIndex < frameWindow.startFrame
    || outputFrameIndex >= frameWindow.endFrameExclusive
  ) {
    return null;
  }

  const frameCount = frameWindow.endFrameExclusive - frameWindow.startFrame;
  return frameCount <= 1
    ? 0
    : (outputFrameIndex - frameWindow.startFrame) / (frameCount - 1);
};

const resolveModulatedTemporalDevice = <TEffect extends GeneratorEffectNode>(
  modulationContext: ModulationContext,
  effect: TEffect,
  frameIndex: number,
  sampleStepBeats: number,
): TEffect => resolveModulatedDeviceAtFrame(
  modulationContext,
  effect,
  frameIndex,
  sampleStepBeats,
  DEFAULT_TIMELINE_WINDOW,
) as TEffect;

const applyReverse = (
  state: MaterializedGenerationState,
  targetGroupId: string | null,
  writeOrder: number,
  context: RackStageExecutionContext,
): MaterializedGenerationState => applyFixedDomainTemporalTransform(
  state,
  targetGroupId,
  writeOrder,
  (outputProgress) => ({ start: 0, end: 1, progress: 1 - outputProgress }),
  context,
);

const applyStretch = (
  state: MaterializedGenerationState,
  effect: StretchEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  modulationContext: ModulationContext,
  context: RackStageExecutionContext,
): MaterializedGenerationState => {
  const outputFrameCount = toFrameCount(1, state.timeline.sampleStepBeats);
  return applyFixedDomainTemporalTransform(
    state,
    targetGroupId,
    writeOrder,
    (_outputProgress, frameIndex) => {
      const device = resolveModulatedTemporalDevice(
        modulationContext,
        effect,
        frameIndex,
        state.timeline.sampleStepBeats,
      );
      const progress = resolveWindowSourceProgress(
        frameIndex,
        outputFrameCount,
        state.timeline.sampleStepBeats,
        device.params.start,
        device.params.end,
      );
      return progress === null ? null : { start: 0, end: 1, progress };
    },
    context,
  );
};

const applyTrim = (
  state: MaterializedGenerationState,
  effect: TrimEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  modulationContext: ModulationContext,
  context: RackStageExecutionContext,
): MaterializedGenerationState => applyFixedDomainTemporalTransform(
  state,
  targetGroupId,
  writeOrder,
  (outputProgress, frameIndex) => {
    const device = resolveModulatedTemporalDevice(
      modulationContext,
      effect,
      frameIndex,
      state.timeline.sampleStepBeats,
    );
    const { start, end } = device.params;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > 1 || end <= start) {
      return null;
    }

    return { start, end, progress: outputProgress };
  },
  context,
);

const applyTimeWarp = (
  state: MaterializedGenerationState,
  effect: TimeWarpEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  context: RackStageExecutionContext,
): MaterializedGenerationState => {
  if (isIdentityTimeWarpCurve(effect.params.curve)) {
    return state;
  }

  const remap = createSampledRemapFromTimeWarpCurve(effect.params.curve);
  return applyFixedDomainTemporalTransform(
    state,
    targetGroupId,
    writeOrder,
    (outputProgress) => {
      const progress = evaluateTemporalRemap(remap, outputProgress);
      return progress === null ? null : { start: 0, end: 1, progress };
    },
    context,
  );
};

export const reverseOperator = createRackOperator<'reverse', 'materialize-all'>(
  'materialize-all',
  (state, stage, context) => applyReverse(
    state,
    stage.groupId,
    stage.stageIndex,
    context,
  ),
);

export const stretchOperator = createRackOperator<'stretch', 'materialize-all'>(
  'materialize-all',
  (state, stage, context) => applyStretch(
    state,
    stage.device,
    stage.groupId,
    stage.stageIndex,
    context.modulationContext,
    context,
  ),
);

export const trimOperator = createRackOperator<'trim', 'materialize-all'>(
  'materialize-all',
  (state, stage, context) => applyTrim(
    state,
    stage.device,
    stage.groupId,
    stage.stageIndex,
    context.modulationContext,
    context,
  ),
);

export const timeWarpOperator = createRackOperator<'timewarp', 'materialize-all'>(
  'materialize-all',
  (state, stage, context) => applyTimeWarp(
    state,
    stage.device,
    stage.groupId,
    stage.stageIndex,
    context,
  ),
);
