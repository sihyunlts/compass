import type { SceneTemporalState } from '../../../core/core-types';
import {
  createIdentitySceneTemporalState,
} from '../../../core/scene-operators/temporal';
import {
  type MutableGenerationState,
  type OriginTimelineState,
} from '../../timeline/state';
import {
  cloneTimelineWindow,
  clampSceneTemporalStateToFixedLoop,
  type TimelineWindow,
} from '../../timeline/temporal-window';
import type {
  CanonicalOutputAdapter,
  GenerationFinalCleanupMode,
  GeometryTimeline,
} from '../../types';
import type { OriginFrameRemap } from './types';
import { buildTimelineStateByOriginId } from './timeline-state';
import {
  applyFinalCleanupModeUpdate,
  transitionGenerationState,
  type FinalCleanupModeUpdate,
} from './state-transition';
import {
  buildSourceWindowOriginFrameRemap,
} from './origin-frame-remap';
import {
  buildTimelineRemapPlan,
  createFixedTimelineRemapPolicy,
  type TimelineRemapPlan,
} from './timeline-remap-plan';

type FinalOriginNormalizationDecision =
  | {
    kind: 'preserve';
    reason: FinalOriginPreserveReason;
    sourceWindow: TimelineWindow | null;
    remap: OriginFrameRemap | null;
    temporal: SceneTemporalState;
  }
  | {
    kind: 'cleanup';
    reason: null;
    sourceWindow: TimelineWindow;
    remap: OriginFrameRemap;
    temporal: SceneTemporalState;
  };

type FinalOriginPreserveReason =
  | 'preserved-origin'
  | 'uncleanable-playback-window';

interface FinalOriginNormalizationInput {
  originId: string;
  timelineState: OriginTimelineState;
  finalCleanupMode: GenerationFinalCleanupMode;
}

const FINAL_TIMELINE_REMAP_POLICY = createFixedTimelineRemapPolicy({
  preserveWriteMetadata: true,
  applyWhenEmpty: true,
});

const resolveFinalCleanupMode = (
  timelineState: OriginTimelineState,
): GenerationFinalCleanupMode => (
  timelineState.temporal.hasAuthoredTimeline || timelineState.finalCleanupMode === 'preserve'
    ? 'preserve'
    : timelineState.finalCleanupMode
);

const resolveFinalOriginPreserveReason = (
  input: FinalOriginNormalizationInput,
): FinalOriginPreserveReason | null => {
  if (input.finalCleanupMode === 'preserve') {
    return 'preserved-origin';
  }

  return null;
};

const resolveFinalOriginNormalizationDecision = (
  timeline: GeometryTimeline,
  input: FinalOriginNormalizationInput,
): FinalOriginNormalizationDecision => {
  const { timelineState } = input;
  const normalizedTemporal = clampSceneTemporalStateToFixedLoop(timelineState.temporal);
  const preserveReason = resolveFinalOriginPreserveReason(input);
  if (preserveReason !== null) {
    return {
      kind: 'preserve',
      reason: preserveReason,
      sourceWindow: null,
      remap: null,
      temporal: normalizedTemporal,
    };
  }

  const sourceWindow = timelineState.observedWindow;
  const remap = buildSourceWindowOriginFrameRemap(
    timeline,
    FINAL_TIMELINE_REMAP_POLICY.outputEndBeat,
    sourceWindow,
    createIdentitySceneTemporalState(),
    0,
    input.finalCleanupMode === 'align-end' ? 'end' : 'start',
  );
  if (!remap) {
    return {
      kind: 'preserve',
      reason: 'uncleanable-playback-window',
      sourceWindow: null,
      remap: null,
      temporal: normalizedTemporal,
    };
  }

  return {
    kind: 'cleanup',
    reason: null,
    sourceWindow: cloneTimelineWindow(sourceWindow),
    remap,
    temporal: remap.nextTemporal,
  };
};

const buildFinalOriginNormalizationInputs = (
  state: MutableGenerationState,
): FinalOriginNormalizationInput[] => Array.from(
  state.timelineStateByOriginId.entries(),
  ([originId, timelineState]) => ({
    originId,
    timelineState,
    finalCleanupMode: resolveFinalCleanupMode(timelineState),
  }),
);

const buildFinalOriginNormalizationDecisions = (
  inputs: ReadonlyArray<FinalOriginNormalizationInput>,
  timeline: GeometryTimeline,
): Map<string, FinalOriginNormalizationDecision> => {
  const decisions = new Map<string, FinalOriginNormalizationDecision>();

  for (const input of inputs) {
    decisions.set(
      input.originId,
      resolveFinalOriginNormalizationDecision(
        timeline,
        input,
      ),
    );
  }

  return decisions;
};

const buildFinalOriginRemaps = (
  decisions: ReadonlyMap<string, FinalOriginNormalizationDecision>,
): Map<string, OriginFrameRemap> => {
  const remaps = new Map<string, OriginFrameRemap>();

  for (const [originId, decision] of decisions.entries()) {
    if (decision.kind !== 'cleanup') {
      continue;
    }

    remaps.set(originId, decision.remap);
  }

  return remaps;
};

const buildFinalTemporalOverrides = (
  decisions: ReadonlyMap<string, FinalOriginNormalizationDecision>,
): Map<string, SceneTemporalState> => new Map(
  Array.from(
    decisions.entries(),
    ([originId, decision]) => [originId, decision.temporal] as const,
  ),
);

interface FinalTimelineNormalizationPlan extends TimelineRemapPlan {
  originDecisions: ReadonlyMap<string, FinalOriginNormalizationDecision>;
  temporalOverrides: ReadonlyMap<string, SceneTemporalState>;
  pendingTemporalWriteOrderByOriginId: Map<string, number>;
  finalCleanupModeUpdate: FinalCleanupModeUpdate;
}

const buildFinalTimelineNormalizationPlan = (
  state: MutableGenerationState,
): FinalTimelineNormalizationPlan => {
  const originDecisions = buildFinalOriginNormalizationDecisions(
    buildFinalOriginNormalizationInputs(state),
    state.timeline,
  );
  const originRemaps = buildFinalOriginRemaps(originDecisions);
  const remapPlan = buildTimelineRemapPlan(
    state.timeline,
    originRemaps,
    FINAL_TIMELINE_REMAP_POLICY,
  );

  return {
    ...remapPlan,
    originDecisions,
    temporalOverrides: buildFinalTemporalOverrides(originDecisions),
    pendingTemporalWriteOrderByOriginId: new Map<string, number>(),
    finalCleanupModeUpdate: {
      mode: 'cleanup',
      originIds: state.timelineStateByOriginId.keys(),
    },
  };
};

export const applyFinalTimelineNormalization = (
  state: MutableGenerationState,
  outputAdapter: CanonicalOutputAdapter,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const normalizationPlan = buildFinalTimelineNormalizationPlan(state);
  const timelineStateByOriginId = buildTimelineStateByOriginId(
    normalizationPlan.timeline,
    state.timelineStateByOriginId,
    outputAdapter,
    mutedGroupIds,
    mutedGeneratorIds,
    normalizationPlan.temporalOverrides,
  );

  return transitionGenerationState(state, {
    timeline: normalizationPlan.timeline,
    timelineStateByOriginId: applyFinalCleanupModeUpdate(
      timelineStateByOriginId,
      normalizationPlan.finalCleanupModeUpdate,
    ),
    pendingTemporalWriteOrderByOriginId: normalizationPlan.pendingTemporalWriteOrderByOriginId,
  });
};
