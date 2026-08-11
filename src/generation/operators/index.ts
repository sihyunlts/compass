import type { GeneratorChain } from '../../shared/model';
import type { OperatorExecutionPlan } from '../analysis/types';
import type { CompiledRackPlan, CompiledRackStage, RackStageDeviceKind } from '../plan/types';
import { resolveCompiledRackSampleStepBeats } from '../plan/sampling';
import { createEmptyGenerationState, type MutableGenerationState } from '../timeline/state';
import type { CanonicalOutputAdapter, GeometryTimeline } from '../types';
import { colorOperator } from './color';
import { generatorOperator } from './generator';
import { maskOperator } from './mask';
import { spatialTransformOperator } from './spatial';
import { symmetryOperator } from './symmetry';
import {
  createModulationContext,
  createRackStageExecutionContext,
  materializeAndNormalizeRackState,
  prepareRackOperatorInput,
  resolveMaskReferenceMutedGeneratorIds,
  resolveMaskReferenceMutedGroupIds,
  shouldApplyReferenceStage,
  type MaskSourceReferenceContext,
  type MaskSourceReferenceRequest,
  type MaskSourceReferenceResult,
  type RackOperator,
  type RackStageExecutionContext,
} from './runtime';
import { reverseOperator, stretchOperator, timeWarpOperator, trimOperator } from './temporal';

const RACK_OPERATORS: Record<RackStageDeviceKind, RackOperator> = {
  ripple: generatorOperator,
  scanner: generatorOperator,
  rain: generatorOperator,
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
  switch (operator.inputPolicy) {
    case 'preserve-pending':
      return operator.execute(
        prepareRackOperatorInput(operator.inputPolicy, state, context),
        stage,
        context,
      );
    case 'materialize-all':
      return operator.execute(
        prepareRackOperatorInput(operator.inputPolicy, state, context),
        stage,
        context,
      );
  }
};

const resolveMaskSourceReference = (
  context: MaskSourceReferenceContext,
  request: MaskSourceReferenceRequest,
): MaskSourceReferenceResult => {
  const { sourceKind, sourceId } = request;
  if (!sourceId) {
    return { status: 'unconfigured' };
  }

  const sourceKey = `${sourceKind}:${sourceId}`;
  const cached = context.timelineBySourceKey.get(sourceKey);
  if (cached) {
    return { status: 'resolved', timeline: cached };
  }

  if (context.resolvingSourceKeys.has(sourceKey)) {
    return { status: 'cycle' };
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
    let currentState = createEmptyGenerationState(context.sampleStepBeats);

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

    const normalizedState = materializeAndNormalizeRackState(currentState, stageExecutionContext);
    const timeline = normalizedState.timeline;
    context.timelineBySourceKey.set(sourceKey, timeline);
    return { status: 'resolved', timeline };
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
  const sampleStepBeats = resolveCompiledRackSampleStepBeats(compiledPlan);
  const modulationContext = createModulationContext(modulationChain, loopLengthBeats);
  const referenceContext: MaskSourceReferenceContext = {
    compiledPlan,
    sampleStepBeats,
    outputAdapter,
    modulationContext,
    executionPlanByDeviceId,
    mutedGroupIds,
    mutedGeneratorIds,
    timelineBySourceKey: new Map<string, GeometryTimeline>(),
    resolvingSourceKeys: new Set<string>(),
    resolveReference: (request) => resolveMaskSourceReference(
      referenceContext,
      request,
    ),
  };
  const stageExecutionContext = createRackStageExecutionContext(referenceContext);
  let currentState = createEmptyGenerationState(sampleStepBeats);

  for (const stage of compiledPlan.stages) {
    currentState = applyCompiledRackStage(
      currentState,
      stage,
      stageExecutionContext,
    );
  }

  return materializeAndNormalizeRackState(currentState, stageExecutionContext);
};
