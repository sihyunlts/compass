import type { SceneTemporalState } from '../../core/core-types';
import {
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
import type { MutableGenerationState } from '../timeline/state';
import {
  buildReverseTransform,
  buildStretchTransform,
  buildTimeWarpTransform,
  buildTrimTransform,
  composeTimelineWindowTemporalState,
  DEFAULT_TIMELINE_WINDOW,
  hasPendingTemporalState,
  isFixedTimelineWindow,
  reverseSampledTimelineTemporalState,
  type TimelineWindow,
} from '../timeline/temporal-window';
import { toFrameWindow, type FrameWindow } from '../timeline';
import type { GeometryTimeline } from '../types';
import {
  buildTemporalStateUpdatesForTargetOrigins,
  createTemporalStateUpdateOperator,
  isFrameWithinWindow,
  resolveModulatedDeviceAtFrame,
  type ModulationContext,
} from './runtime';

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

const resolveTemporalCompositionSampleCount = (
  timeline: GeometryTimeline,
  window: TimelineWindow,
): number => {
  const frameWindow = toFrameWindow(
    window,
    timeline.sampleStepBeats,
    timeline.frames.length,
  );

  return frameWindow.endFrameExclusive - frameWindow.startFrame;
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

const buildReverseTemporalUpdates = (
  state: MutableGenerationState,
  targetGroupId: string | null,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, SceneTemporalState> => buildTemporalStateUpdatesForTargetOrigins(
  state,
  targetGroupId,
  requiredFrameWindow,
  ({ currentTemporal, frameWindow, placementWindow, sourceWindow, timelineState }) => {
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

    const reversedSampledTemporal = reverseSampledTimelineTemporalState(
      currentTemporal,
      placementWindow,
    );
    if (reversedSampledTemporal) {
      return reversedSampledTemporal;
    }

    const sampleCount = resolveTemporalCompositionSampleCount(state.timeline, placementWindow);
    return composeTimelineWindowTemporalState(
      timelineState,
      currentTemporal,
      buildReverseTransform(sourceWindow, placementWindow, sampleCount),
      sampleCount,
    );
  },
);

const buildTrimTemporalUpdates = (
  state: MutableGenerationState,
  effect: TrimEffectNode,
  targetGroupId: string | null,
  modulationContext: ModulationContext,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, SceneTemporalState> => buildTemporalStateUpdatesForTargetOrigins(
  state,
  targetGroupId,
  requiredFrameWindow,
  ({ currentTemporal, frameWindow, sourceWindow, timelineState }) => {
    const trimSourceWindow = hasPendingTemporalState(timelineState)
      ? DEFAULT_TIMELINE_WINDOW
      : sourceWindow;

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

        return composeTimelineWindowTemporalState(
          timelineState,
          currentTemporal,
          buildTrimTransform(trimSourceWindow, start, end),
          resolveTemporalCompositionSampleCount(state.timeline, { start: 0, end: 1 }),
        );
      },
    );
  },
);

const buildStretchTemporalUpdates = (
  state: MutableGenerationState,
  effect: StretchEffectNode,
  targetGroupId: string | null,
  modulationContext: ModulationContext,
  requiredFrameWindow: BeatRange | 'all',
): Map<string, SceneTemporalState> => buildTemporalStateUpdatesForTargetOrigins(
  state,
  targetGroupId,
  requiredFrameWindow,
  ({ currentTemporal, frameWindow, sourceWindow, timelineState }) => {
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
        if (isFixedTimelineWindow({ start, end })) {
          return null;
        }
        if (outputBeat < start || outputBeat >= end) {
          return null;
        }

        return composeTimelineWindowTemporalState(
          timelineState,
          currentTemporal,
          buildStretchTransform(sourceWindow, start, end),
          resolveTemporalCompositionSampleCount(state.timeline, { start, end }),
        );
      },
    );
  },
);

const buildTimeWarpTemporalUpdates = (
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
    ({ currentTemporal, frameWindow, placementWindow, sourceWindow, timelineState }) => {
      const placementSpan = placementWindow.end - placementWindow.start;
      const sourceSpan = sourceWindow.end - sourceWindow.start;
      if (!Number.isFinite(placementSpan) || placementSpan <= 0) {
        return null;
      }
      if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) {
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

      return composeTimelineWindowTemporalState(
        timelineState,
        currentTemporal,
        buildTimeWarpTransform(sourceWindow, placementWindow, remap, state.timeline.sampleStepBeats),
        resolveTemporalCompositionSampleCount(state.timeline, placementWindow),
      );
    },
  );
};

export const reverseOperator = createTemporalStateUpdateOperator<'reverse'>(
  (state, stage) => {
    return buildReverseTemporalUpdates(
      state,
      stage.groupId,
      'all',
    );
  },
  'align-end',
);

export const trimOperator = createTemporalStateUpdateOperator<'trim'>(
  (state, stage, context) => {
    const device = stage.device;
    return buildTrimTemporalUpdates(
      state,
      device,
      stage.groupId,
      context.modulationContext,
      'all',
    );
  },
  'cleanup',
);

export const stretchOperator = createTemporalStateUpdateOperator<'stretch'>(
  (state, stage, context) => {
    const device = stage.device;
    return buildStretchTemporalUpdates(
      state,
      device,
      stage.groupId,
      context.modulationContext,
      'all',
    );
  },
  'preserve',
);

export const timeWarpOperator = createTemporalStateUpdateOperator<'timewarp'>(
  (state, stage) => {
    const device = stage.device;
    return buildTimeWarpTemporalUpdates(
      state,
      device,
      stage.groupId,
      'all',
    );
  },
);
