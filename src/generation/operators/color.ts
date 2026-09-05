import {
  buildColorConfig,
} from '../../devices/color/color-program';
import type { ColorEffectNode } from '../../shared/model';
import { compileColorAgeKernel } from '../color/age-kernel';
import { materializeColorTimeline } from '../color/materialization';
import {
  type MaterializedGenerationState,
  type GenerationState,
} from '../timeline/state';
import {
  buildTargetOriginIds,
  createRackOperator,
  replaceTimelineAndRefreshRackState,
  type RackStageExecutionContext,
} from './runtime';

const applyColorEffect = (
  sourceState: MaterializedGenerationState,
  effect: ColorEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
  context: RackStageExecutionContext,
): GenerationState => {
  const targetOriginIds = buildTargetOriginIds(
    sourceState.timeline,
    targetGroupId,
    {
      excludeMutedSources: targetGroupId === null,
      mutedGroupIds,
      mutedGeneratorIds,
    },
  );
  const kernel = compileColorAgeKernel(buildColorConfig(effect));
  if (targetOriginIds.size === 0) {
    return sourceState;
  }

  const materialization = materializeColorTimeline({
    sourceTimeline: sourceState.timeline,
    targetOriginIds,
    kernel,
    writeOrder,
  });

  return replaceTimelineAndRefreshRackState(
    sourceState,
    materialization.timeline,
    sourceState.timelineStateByOriginId,
    context,
    new Map(Array.from(
      materialization.playbackExtentByOriginId,
      ([originId, playbackExtent]) => [originId, { playbackExtent }] as const,
    )),
  );
};

export const colorOperator = createRackOperator<'color', 'materialize-all'>(
  'materialize-all',
  (state, stage, context) => {
    const device = stage.device;

    return applyColorEffect(
      state,
      device,
      stage.groupId,
      stage.stageIndex,
      context.mutedGroupIds,
      context.mutedGeneratorIds,
      context,
    );
  },
);
