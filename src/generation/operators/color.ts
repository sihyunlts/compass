import {
  buildColorConfig,
} from '../../devices/color/color-program';
import type { ColorEffectNode } from '../../shared/model';
import type { BeatRange } from '../analysis/types';
import { compileColorAgeKernel } from '../color/age-kernel';
import { materializeColorTimeline } from '../color/materialization';
import {
  type MutableGenerationState,
} from '../timeline/state';
import {
  buildTargetOriginIds,
  createPendingFrameApplicationOperator,
  replaceTimelineAndRefreshRackState,
  resolveFrameWindow,
  resolveStageExecutionPlan,
  type PendingFrameApplicationOperatorInput,
  type RackStageExecutionContext,
} from './runtime';

const applyColorEffect = (
  input: PendingFrameApplicationOperatorInput,
  effect: ColorEffectNode,
  targetGroupId: string | null,
  writeOrder: number,
  requiredFrameWindow: BeatRange | 'all',
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
  context: RackStageExecutionContext,
): MutableGenerationState => {
  const sourceState = input.sourceState;
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
    sourceFrameWindow: resolveFrameWindow(
      requiredFrameWindow,
      sourceState.timeline.sampleStepBeats,
      sourceState.timeline.frames.length,
    ),
    kernel,
    writeOrder,
  });

  return replaceTimelineAndRefreshRackState(
    sourceState,
    materialization.timeline,
    sourceState.timelineStateByOriginId,
    context,
    targetOriginIds,
    materialization.playbackWindowByOriginId,
  );
};

export const colorOperator = createPendingFrameApplicationOperator<'color'>(
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
      context,
    );
  },
);
