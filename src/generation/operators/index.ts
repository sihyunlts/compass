import type { GeneratorChain } from '../../shared/model';
import type { OperatorExecutionPlan } from '../analysis/types';
import type { CompiledRackPlan, CompiledRackStage, RackStageDeviceKind } from '../plan/types';
import type { MutableGenerationState, OriginTimelineState } from '../timeline/state';
import { createEmptyTimeline } from '../timeline';
import type { CanonicalOutputAdapter, GeometryTimeline } from '../types';
import { colorOperator } from './color';
import { generatorOperator } from './generator';
import { maskOperator } from './mask';
import { spatialTransformOperator } from './spatial';
import { symmetryOperator } from './symmetry';
import {
  createModulationContext,
  createRackStageExecutionContext,
  materializeAndSealRackState,
  resolveMaskReferenceMutedGeneratorIds,
  resolveMaskReferenceMutedGroupIds,
  shouldApplyReferenceStage,
  type MaskSourceReferenceContext,
  type RackOperator,
  type RackStageExecutionContext,
} from './runtime';
import { reverseOperator, stretchOperator, timeWarpOperator, trimOperator } from './temporal';

const RACK_OPERATORS: Record<RackStageDeviceKind, RackOperator> = {
  waterdrop: generatorOperator,
  scanner: generatorOperator,
  spiral: generatorOperator,
  path: generatorOperator,
  mirror: spatialTransformOperator,
  rotate: spatialTransformOperator,
  translate: spatialTransformOperator,
  scale: spatialTransformOperator,
  symmetry: symmetryOperator,
  color: colorOperator,
  mask: maskOperator,
  reverse: reverseOperator,
  trim: trimOperator,
  stretch: stretchOperator,
  timewarp: timeWarpOperator,
};

const getRackOperator = (
  deviceKind: RackStageDeviceKind,
): RackOperator => RACK_OPERATORS[deviceKind];

const applyCompiledRackStage = (
  state: MutableGenerationState,
  stage: CompiledRackStage,
  context: RackStageExecutionContext,
): MutableGenerationState => {
  const operator = getRackOperator(stage.deviceKind);
  return operator.execute(
    operator.prepareInput(state, context),
    stage,
    context,
  );
};

const resolveMaskSourceReferenceTimeline = (
  context: MaskSourceReferenceContext,
  sourceKind: 'group' | 'generator',
  sourceId: string,
): GeometryTimeline | null => {
  const sourceKey = `${sourceKind}:${sourceId}`;
  const cached = context.timelineBySourceKey.get(sourceKey);
  if (cached) {
    return cached;
  }

  if (context.resolvingSourceKeys.has(sourceKey)) {
    return createEmptyTimeline();
  }

  context.resolvingSourceKeys.add(sourceKey);
  try {
    const referenceMutedGroupIds = resolveMaskReferenceMutedGroupIds(
      context,
      sourceKind,
      sourceId,
    );
    const referenceMutedGeneratorIds = resolveMaskReferenceMutedGeneratorIds(
      context,
      sourceKind,
      sourceId,
    );
    const referenceContext: MaskSourceReferenceContext = {
      ...context,
      mutedGroupIds: referenceMutedGroupIds,
      mutedGeneratorIds: referenceMutedGeneratorIds,
    };
    const stageExecutionContext = createRackStageExecutionContext(referenceContext);
    let currentState: MutableGenerationState = {
      timeline: createEmptyTimeline(),
      timelineStateByOriginId: new Map<string, OriginTimelineState>(),
      pendingTemporalWriteOrderByOriginId: new Map<string, number>(),
      sealedOriginIds: new Set<string>(),
    };

    for (const stage of context.compiledPlan.stages) {
      if (!shouldApplyReferenceStage(stage, context, sourceKind, sourceId)) {
        continue;
      }

      currentState = applyCompiledRackStage(
        currentState,
        stage,
        stageExecutionContext,
      );
    }

    const sealedState = materializeAndSealRackState(currentState, stageExecutionContext);
    const timeline = sealedState.timeline;
    context.timelineBySourceKey.set(sourceKey, timeline);
    return timeline;
  } finally {
    context.resolvingSourceKeys.delete(sourceKey);
  }
};

export const executeCompiledRackPlan = (
  compiledPlan: CompiledRackPlan,
  modulationChain: GeneratorChain,
  loopLengthBeats: number,
  outputAdapter: CanonicalOutputAdapter,
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>,
  mutedGroupIds: ReadonlySet<string>,
  mutedGeneratorIds: ReadonlySet<string>,
): MutableGenerationState => {
  const modulationContext = createModulationContext(modulationChain, loopLengthBeats);
  const referenceContext: MaskSourceReferenceContext = {
    compiledPlan,
    outputAdapter,
    modulationContext,
    executionPlanByDeviceId,
    mutedGroupIds,
    mutedGeneratorIds,
    timelineBySourceKey: new Map<string, GeometryTimeline>(),
    resolvingSourceKeys: new Set<string>(),
    resolveReferenceTimeline: (sourceKind, sourceId) => resolveMaskSourceReferenceTimeline(
      referenceContext,
      sourceKind,
      sourceId,
    ),
  };
  const stageExecutionContext = createRackStageExecutionContext(referenceContext);
  let currentState: MutableGenerationState = {
    timeline: createEmptyTimeline(),
    timelineStateByOriginId: new Map<string, OriginTimelineState>(),
    pendingTemporalWriteOrderByOriginId: new Map<string, number>(),
    sealedOriginIds: new Set<string>(),
  };

  for (const stage of compiledPlan.stages) {
    currentState = applyCompiledRackStage(
      currentState,
      stage,
      stageExecutionContext,
    );
  }

  return materializeAndSealRackState(currentState, stageExecutionContext);
};
