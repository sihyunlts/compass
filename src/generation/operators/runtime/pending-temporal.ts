import type { SceneTemporalState } from '../../../core/core-types';
import {
  cloneSceneTemporalState,
  evaluateTemporalRemap,
} from '../../../core/scene-operators/temporal';
import {
  clonePendingFrameApplications,
  clonePendingTemporalWriteOrderByOriginId,
  cloneSealedOriginIds,
  cloneTimelineStateByOriginId,
  type MutableGenerationState,
  type PendingTemporalMaterializationCheckpoint,
} from '../../timeline/state';
import {
  cloneTimelineWindow,
  createMaterializedTemporalState,
  FIXED_TIMELINE_END_BEAT,
  hasPendingTemporalState,
  resolveTemporalPlacementWindow,
} from '../../timeline/temporal-window';
import { toFrameCount } from '../../timeline';
import type { CanonicalOutputAdapter, GeometryTimeline } from '../../types';
import { buildTimelineStateAfterTemporalMaterialization } from './timeline-state';
import { toSourceFrameIndex } from './timeline-strokes';
import { remapTimeline } from './frame-remap';
import type { OriginFrameRemap } from './types';

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
      playbackWindow: cloneTimelineWindow(existing.playbackWindow),
      temporal: cloneSceneTemporalState(nextTemporal),
    });
    pendingTemporalWriteOrderByOriginId.set(originId, writeOrder);
  }

  return {
    timeline: state.timeline,
    timelineStateByOriginId,
    pendingTemporalWriteOrderByOriginId,
    pendingFrameApplications: clonePendingFrameApplications(state.pendingFrameApplications),
    sealedOriginIds: cloneSealedOriginIds(state.sealedOriginIds),
  };
};

const buildTemporalMaterializationRemaps = (
  timeline: GeometryTimeline,
  temporalByOriginId: ReadonlyMap<string, SceneTemporalState>,
  writeOrderByOriginId: ReadonlyMap<string, number>,
): Map<string, OriginFrameRemap> => {
  const remaps = new Map<string, OriginFrameRemap>();
  const outputFrameCount = toFrameCount(FIXED_TIMELINE_END_BEAT, timeline.sampleStepBeats);

  for (const [originId, temporal] of temporalByOriginId.entries()) {
    const placementWindow = temporal.visibilityWindow;
    const placementSpan = placementWindow.end - placementWindow.start;
    const sourceFrameIndexByOutputFrame: Array<number | null> = !Number.isFinite(placementSpan) || placementSpan <= 0
      ? Array.from({ length: outputFrameCount }, (): number | null => null)
      : Array.from(
          { length: outputFrameCount },
          (_, frameIndex) => {
            const outputBeat = frameIndex * timeline.sampleStepBeats;
            if (outputBeat < placementWindow.start || outputBeat >= placementWindow.end) {
              return null;
            }

            const sourceBeat = evaluateTemporalRemap(temporal.remap, outputBeat);
            if (sourceBeat === null || !Number.isFinite(sourceBeat)) {
              return null;
            }

            return toSourceFrameIndex(sourceBeat, timeline);
          },
        );

    remaps.set(originId, {
      nextTemporal: createMaterializedTemporalState(placementWindow),
      sourceFrameIndexByOutputFrame,
      writeOrder: writeOrderByOriginId.get(originId) ?? 0,
    });
  }

  return remaps;
};

const buildPendingTemporalMaterializationRemaps = (
  state: MutableGenerationState,
): Map<string, OriginFrameRemap> => buildTemporalMaterializationRemaps(
  state.timeline,
  new Map(
    Array.from(state.timelineStateByOriginId.entries())
      .filter(([, timelineState]) => hasPendingTemporalState(timelineState))
      .map(([originId, timelineState]) => [originId, timelineState.temporal] as const),
  ),
  state.pendingTemporalWriteOrderByOriginId,
);

export const materializeTemporalCheckpointTimeline = (
  timeline: GeometryTimeline,
  checkpoint: PendingTemporalMaterializationCheckpoint,
): GeometryTimeline => {
  if (checkpoint.temporalByOriginId.size === 0) {
    return timeline;
  }

  const remaps = buildTemporalMaterializationRemaps(
    timeline,
    checkpoint.temporalByOriginId,
    checkpoint.writeOrderByOriginId,
  );

  return remaps.size > 0
    ? remapTimeline(
        timeline,
        remaps,
        'all',
        FIXED_TIMELINE_END_BEAT,
        false,
      )
    : timeline;
};

export const extractPendingTemporalCheckpoint = (
  state: MutableGenerationState,
): {
  checkpoint: PendingTemporalMaterializationCheckpoint;
  state: MutableGenerationState;
} | null => {
  const temporalByOriginId = new Map<string, SceneTemporalState>();
  const writeOrderByOriginId = new Map<string, number>();
  const timelineStateByOriginId = cloneTimelineStateByOriginId(state.timelineStateByOriginId);
  const pendingTemporalWriteOrderByOriginId = clonePendingTemporalWriteOrderByOriginId(
    state.pendingTemporalWriteOrderByOriginId,
  );

  for (const [originId, timelineState] of timelineStateByOriginId.entries()) {
    if (!hasPendingTemporalState(timelineState)) {
      continue;
    }

    temporalByOriginId.set(originId, cloneSceneTemporalState(timelineState.temporal));
    writeOrderByOriginId.set(originId, pendingTemporalWriteOrderByOriginId.get(originId) ?? 0);
    timelineStateByOriginId.set(originId, {
      observedWindow: cloneTimelineWindow(timelineState.observedWindow),
      playbackWindow: cloneTimelineWindow(timelineState.playbackWindow),
      temporal: createMaterializedTemporalState(resolveTemporalPlacementWindow(timelineState)),
    });
    pendingTemporalWriteOrderByOriginId.delete(originId);
  }

  if (temporalByOriginId.size === 0) {
    return null;
  }

  return {
    checkpoint: {
      temporalByOriginId,
      writeOrderByOriginId,
    },
    state: {
      timeline: state.timeline,
      timelineStateByOriginId,
      pendingTemporalWriteOrderByOriginId,
      pendingFrameApplications: clonePendingFrameApplications(state.pendingFrameApplications),
      sealedOriginIds: cloneSealedOriginIds(state.sealedOriginIds),
    },
  };
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
        state.timeline,
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
  const materializedTemporalByOriginId = new Map(
    Array.from(remaps.entries(), ([originId, remap]) => [originId, remap.nextTemporal] as const),
  );

  return {
    timeline,
    timelineStateByOriginId: buildTimelineStateAfterTemporalMaterialization(
      timeline,
      state.timelineStateByOriginId,
      pendingOriginIds,
      outputAdapter,
      mutedGroupIds,
      mutedGeneratorIds,
      materializedTemporalByOriginId,
    ),
    pendingTemporalWriteOrderByOriginId,
    pendingFrameApplications: clonePendingFrameApplications(state.pendingFrameApplications),
    sealedOriginIds: cloneSealedOriginIds(state.sealedOriginIds),
  };
};
