import type { SceneTemporalState } from '../../core/core-types';
import {
  composeSceneTemporalState,
  createIdentitySceneTemporalState,
  evaluateTemporalRemap,
} from '../../core/scene-operators/temporal';
import { createSampledRemapFromTimeWarpCurve, isIdentityTimeWarpCurve } from '../../core/timewarp/curve';
import type {
  GeneratorEffectNode,
  StretchEffectNode,
  TimeWarpEffectNode,
  TrimEffectNode,
} from '../../shared/model';
import type { BeatRange } from '../analysis/types';
import type { OriginTimelineState, MutableGenerationState } from '../timeline/state';
import {
  buildPlacementPreservingTimeWarpTransform,
  buildReverseTransform,
  buildStretchTransform,
  buildTrimTransform,
  isFixedTimelineWindow,
  resolveTemporalPlacementWindow,
  resolveTemporalSourceWindow,
} from '../timeline/temporal-window';
import type { FrameWindow } from '../timeline';
import type { GeometryTimeline } from '../types';
import {
  applyTemporalStateUpdates,
  buildTargetOriginIds,
  createRackOperator,
  isFrameWithinWindow,
  prepareTemporalRackOperatorInput,
  resolveFrameWindow,
  resolveModulatedDeviceAtFrame,
  type ModulationContext,
} from './runtime';

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
      state.timeline.timeDomainEndBeat,
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
  (originId, timelineState, frameWindow) => {
    const placementWindow = resolveTemporalPlacementWindow(timelineState);
    const sourceWindow = timelineState?.temporal.hasAuthoredTimeline === true
      ? placementWindow
      : resolveTemporalSourceWindow(state.timelineStateByOriginId, originId);
    if (!sourceWindow) {
      return null;
    }

    const sourceSpan = sourceWindow.end - sourceWindow.start;
    const placementSpan = placementWindow.end - placementWindow.start;
    if (
      !Number.isFinite(sourceSpan)
      || sourceSpan <= 0
      || !Number.isFinite(placementSpan)
      || placementSpan <= 0
    ) {
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
      buildReverseTransform(sourceWindow, placementWindow, state.timeline.sampleStepBeats),
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
  (originId, timelineState, frameWindow) => {
    const sourceWindow = resolveTemporalSourceWindow(state.timelineStateByOriginId, originId);
    if (!sourceWindow) {
      return null;
    }

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
        if (isFixedTimelineWindow({ start, end })) {
          return null;
        }

        return composeSceneTemporalState(
          timelineState?.temporal ?? createIdentitySceneTemporalState(),
          buildTrimTransform(sourceWindow, start, end),
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
    const sourceWindow = resolveTemporalSourceWindow(state.timelineStateByOriginId, originId);
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
      const placementWindow = resolveTemporalPlacementWindow(timelineState);
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

const applyTemporalUpdatesForStage = (
  state: MutableGenerationState,
  temporalUpdates: ReadonlyMap<string, SceneTemporalState>,
  stage: { stageIndex: number },
): MutableGenerationState => (
  temporalUpdates.size > 0
    ? applyTemporalStateUpdates(
        state,
        temporalUpdates,
        stage.stageIndex,
      )
    : state
);

export const reverseOperator = createRackOperator<'reverse'>(
  prepareTemporalRackOperatorInput,
  (state, stage) => {
    return applyTemporalUpdatesForStage(
      state,
      buildReverseRemaps(
        state,
        stage.groupId,
        'all',
      ),
      stage,
    );
  },
);

export const trimOperator = createRackOperator<'trim'>(
  prepareTemporalRackOperatorInput,
  (state, stage, context) => {
    const device = stage.device;
    return applyTemporalUpdatesForStage(
      state,
      buildTrimRemaps(
        state,
        device,
        stage.groupId,
        context.modulationContext,
        'all',
      ),
      stage,
    );
  },
);

export const stretchOperator = createRackOperator<'stretch'>(
  prepareTemporalRackOperatorInput,
  (state, stage, context) => {
    const device = stage.device;
    return applyTemporalUpdatesForStage(
      state,
      buildStretchRemaps(
        state,
        device,
        stage.groupId,
        context.modulationContext,
        'all',
      ),
      stage,
    );
  },
);

export const timeWarpOperator = createRackOperator<'timewarp'>(
  prepareTemporalRackOperatorInput,
  (state, stage) => {
    const device = stage.device;
    return applyTemporalUpdatesForStage(
      state,
      buildTimeWarpRemaps(
        state,
        device,
        stage.groupId,
        'all',
      ),
      stage,
    );
  },
);
