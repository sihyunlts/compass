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
import type { MutableGenerationState, OriginTimelineState } from '../timeline/state';
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
import type { GenerationFinalCleanupMode, GeometryTimeline } from '../types';
import {
  buildTemporalStateUpdatesForTargetOrigins,
  createTemporalStateUpdateOperator,
  isFrameWithinWindow,
  resolveModulatedDeviceAtFrame,
  type ModulationContext,
} from './runtime';

type TemporalEffectKind = 'reverse' | 'trim' | 'stretch' | 'timewarp';

type TemporalSourceWindowPolicy =
  | 'playback-window'
  | 'current-output-when-pending';

type TemporalPlacementWindowPolicy =
  | 'current-placement'
  | 'authored-window'
  | 'full-loop';

interface TemporalEffectPolicy {
  sourceWindow: TemporalSourceWindowPolicy;
  placementWindow: TemporalPlacementWindowPolicy;
  cleanupMode?: GenerationFinalCleanupMode;
}

const TEMPORAL_EFFECT_POLICIES = {
  reverse: {
    sourceWindow: 'playback-window',
    placementWindow: 'current-placement',
    cleanupMode: 'align-end',
  },
  trim: {
    sourceWindow: 'current-output-when-pending',
    placementWindow: 'full-loop',
    cleanupMode: 'cleanup',
  },
  stretch: {
    sourceWindow: 'playback-window',
    placementWindow: 'authored-window',
    cleanupMode: 'preserve',
  },
  timewarp: {
    sourceWindow: 'playback-window',
    placementWindow: 'current-placement',
  },
} satisfies Record<TemporalEffectKind, TemporalEffectPolicy>;

const resolveTemporalCleanupMode = (
  kind: TemporalEffectKind,
): GenerationFinalCleanupMode | undefined => TEMPORAL_EFFECT_POLICIES[kind].cleanupMode;

const resolveTemporalEffectSourceWindow = (
  kind: TemporalEffectKind,
  timelineState: OriginTimelineState,
  sourceWindow: TimelineWindow,
): TimelineWindow => (
  TEMPORAL_EFFECT_POLICIES[kind].sourceWindow === 'current-output-when-pending'
    && hasPendingTemporalState(timelineState)
      ? DEFAULT_TIMELINE_WINDOW
      : sourceWindow
);

const resolveTemporalEffectPlacementWindow = (
  kind: TemporalEffectKind,
  currentPlacementWindow: TimelineWindow,
  authoredWindow?: TimelineWindow,
): TimelineWindow => {
  switch (TEMPORAL_EFFECT_POLICIES[kind].placementWindow) {
    case 'current-placement':
      return currentPlacementWindow;
    case 'authored-window':
      return authoredWindow ?? currentPlacementWindow;
    case 'full-loop':
      return DEFAULT_TIMELINE_WINDOW;
  }
};

const resolveTimelineWindowSpan = (
  window: TimelineWindow,
): number => window.end - window.start;

const isUsableTimelineWindow = (
  window: TimelineWindow,
): boolean => {
  const span = resolveTimelineWindowSpan(window);
  return Number.isFinite(span) && span > 0;
};

const isBeatWithinTimelineWindow = (
  beat: number,
  window: TimelineWindow,
): boolean => beat >= window.start && beat < window.end;

const resolveActiveUnitWindow = (
  start: number,
  end: number,
): TimelineWindow | null => {
  const window = { start, end };
  if (
    !Number.isFinite(start)
    || !Number.isFinite(end)
    || start < 0
    || end > 1
    || end <= start
    || isFixedTimelineWindow(window)
  ) {
    return null;
  }

  return window;
};

const hasApplicableFrameInWindow = (
  timeline: GeometryTimeline,
  frameWindow: FrameWindow,
  window: TimelineWindow,
  isApplicableAtBeat: (outputBeat: number) => boolean = () => true,
): boolean => {
  for (let frameIndex = 0; frameIndex < timeline.frames.length; frameIndex += 1) {
    if (!isFrameWithinWindow(frameIndex, frameWindow)) {
      continue;
    }

    const outputBeat = frameIndex * timeline.sampleStepBeats;
    if (
      isBeatWithinTimelineWindow(outputBeat, window)
      && isApplicableAtBeat(outputBeat)
    ) {
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
    const reverseSourceWindow = resolveTemporalEffectSourceWindow('reverse', timelineState, sourceWindow);
    const reversePlacementWindow = resolveTemporalEffectPlacementWindow('reverse', placementWindow);
    if (
      !isUsableTimelineWindow(reverseSourceWindow)
      || !isUsableTimelineWindow(reversePlacementWindow)
    ) {
      return null;
    }

    if (!hasApplicableFrameInWindow(state.timeline, frameWindow, reversePlacementWindow)) {
      return null;
    }

    const reversedSampledTemporal = reverseSampledTimelineTemporalState(
      currentTemporal,
      reversePlacementWindow,
    );
    if (reversedSampledTemporal) {
      return reversedSampledTemporal;
    }

    const sampleCount = resolveTemporalCompositionSampleCount(state.timeline, reversePlacementWindow);
    return composeTimelineWindowTemporalState(
      timelineState,
      currentTemporal,
      buildReverseTransform(reverseSourceWindow, reversePlacementWindow, sampleCount),
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
  ({ currentTemporal, frameWindow, placementWindow, sourceWindow, timelineState }) => {
    const trimSourceWindow = resolveTemporalEffectSourceWindow('trim', timelineState, sourceWindow);
    const trimPlacementWindow = resolveTemporalEffectPlacementWindow('trim', placementWindow);

    return resolveLastModulatedTemporalState(
      state,
      effect,
      modulationContext,
      frameWindow,
      (deviceAtFrame) => {
        const start = deviceAtFrame.params.start;
        const end = deviceAtFrame.params.end;
        const trimWindow = resolveActiveUnitWindow(start, end);
        if (!trimWindow) {
          return null;
        }

        return composeTimelineWindowTemporalState(
          timelineState,
          currentTemporal,
          buildTrimTransform(trimSourceWindow, trimWindow.start, trimWindow.end),
          resolveTemporalCompositionSampleCount(state.timeline, trimPlacementWindow),
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
  ({ currentTemporal, frameWindow, placementWindow, sourceWindow, timelineState }) => {
    const stretchSourceWindow = resolveTemporalEffectSourceWindow('stretch', timelineState, sourceWindow);
    if (!isUsableTimelineWindow(stretchSourceWindow)) {
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
        const authoredWindow = resolveActiveUnitWindow(start, end);
        if (!authoredWindow) {
          return null;
        }
        const stretchPlacementWindow = resolveTemporalEffectPlacementWindow(
          'stretch',
          placementWindow,
          authoredWindow,
        );
        if (!isBeatWithinTimelineWindow(outputBeat, stretchPlacementWindow)) {
          return null;
        }

        return composeTimelineWindowTemporalState(
          timelineState,
          currentTemporal,
          buildStretchTransform(
            stretchSourceWindow,
            stretchPlacementWindow.start,
            stretchPlacementWindow.end,
          ),
          resolveTemporalCompositionSampleCount(state.timeline, stretchPlacementWindow),
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
      const timeWarpSourceWindow = resolveTemporalEffectSourceWindow('timewarp', timelineState, sourceWindow);
      const timeWarpPlacementWindow = resolveTemporalEffectPlacementWindow('timewarp', placementWindow);
      if (
        !isUsableTimelineWindow(timeWarpSourceWindow)
        || !isUsableTimelineWindow(timeWarpPlacementWindow)
      ) {
        return null;
      }
      const placementSpan = resolveTimelineWindowSpan(timeWarpPlacementWindow);

      if (!hasApplicableFrameInWindow(
        state.timeline,
        frameWindow,
        timeWarpPlacementWindow,
        (outputBeat) => {
          const normalized = (outputBeat - timeWarpPlacementWindow.start) / placementSpan;
          const remappedBeat = evaluateTemporalRemap(remap, normalized);
          return remappedBeat !== null && Number.isFinite(remappedBeat);
        },
      )) {
        return null;
      }

      return composeTimelineWindowTemporalState(
        timelineState,
        currentTemporal,
        buildTimeWarpTransform(
          timeWarpSourceWindow,
          timeWarpPlacementWindow,
          remap,
          state.timeline.sampleStepBeats,
        ),
        resolveTemporalCompositionSampleCount(state.timeline, timeWarpPlacementWindow),
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
  resolveTemporalCleanupMode('reverse'),
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
  resolveTemporalCleanupMode('trim'),
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
  resolveTemporalCleanupMode('stretch'),
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
  resolveTemporalCleanupMode('timewarp'),
);
