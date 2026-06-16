import {
  buildColorConfig,
} from '../../devices/color/color-program';
import type { ColorEffectNode } from '../../shared/model';
import type { BeatRange } from '../analysis/types';
import {
  type MutableGenerationState,
} from '../timeline/state';
import {
  appendPendingColorApplication,
  buildTargetOriginIds,
  createPendingGeometryApplicationOperator,
  mergePlaybackWindowOverridesIntoTimelineState,
  resolveStageExecutionPlan,
  type PendingGeometryApplicationOperatorInput,
} from './runtime';
import { resolvePendingColorPlaybackWindowOverrides } from './runtime/color-materialization';

const applyColorEffect = (
  input: PendingGeometryApplicationOperatorInput,
  effect: ColorEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const state = input.baseState;
  const colorConfig = buildColorConfig(effect);
  const targetOriginIds = buildTargetOriginIds(
    state.timeline,
    targetGroupId,
    {
      excludeMutedSources: targetGroupId === null,
      mutedGroupIds,
      mutedGeneratorIds,
    },
  );
  const colorApplication = {
    kind: 'color' as const,
    targetOriginIds,
    targetGroupId,
    requiredFrameWindow,
    colorConfig,
    writeOrder,
  };
  const playbackWindowByOriginId = resolvePendingColorPlaybackWindowOverrides(
    state.timeline,
    colorApplication,
    input.precedingTemporalCheckpoint,
  );

  return appendPendingColorApplication(
    input,
    colorApplication,
    {
      timelineStateByOriginId: mergePlaybackWindowOverridesIntoTimelineState(
        state.timelineStateByOriginId,
        playbackWindowByOriginId,
      ),
      finalCleanupModeUpdate: { mode: 'cleanup', originIds: targetOriginIds },
    },
  );
};

export const colorOperator = createPendingGeometryApplicationOperator<'color'>(
  (input, stage, context) => {
    const device = stage.device;
    const executionPlan = resolveStageExecutionPlan(context, stage);

    return applyColorEffect(
      input,
      device,
      stage.groupId,
      stage.stageIndex,
      executionPlan.requiredFrameWindow,
      context.mutedGroupIds,
      context.mutedGeneratorIds,
    );
  },
);
