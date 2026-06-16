import type { SceneTemporalState } from '../../../core/core-types';
import type { CompiledModulationProgram } from '../../../core/modulation/compiled-program';
import type {
  GeneratorDeviceNode,
  GeneratorEffectNode,
  GeneratorNode,
} from '../../../shared/model';
import type { OperatorExecutionPlan } from '../../analysis/types';
import type {
  CompiledRackPlan,
  CompiledRackStage,
  RackStageDeviceKind,
  RackStageDeviceNode,
} from '../../plan/types';
import type {
  MutableGenerationState,
  PendingTemporalMaterializationCheckpoint,
} from '../../timeline/state';
import type { CanonicalOutputAdapter, GeometryTimeline } from '../../types';

export interface ModulationContext {
  loopLengthBeats: number;
  program: CompiledModulationProgram;
  deviceByFrameKey: Map<string, GeneratorDeviceNode>;
}

export interface MaskSourceReferenceContext {
  compiledPlan: CompiledRackPlan;
  outputAdapter: CanonicalOutputAdapter;
  modulationContext: ModulationContext;
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>;
  mutedGroupIds: ReadonlySet<string>;
  mutedGeneratorIds: ReadonlySet<string>;
  timelineBySourceKey: Map<string, GeometryTimeline>;
  resolvingSourceKeys: Set<string>;
  resolveReferenceTimeline(sourceKind: 'group' | 'generator', sourceId: string): GeometryTimeline | null;
}

export interface RackStageExecutionContext {
  compiledPlan: CompiledRackPlan;
  outputAdapter: CanonicalOutputAdapter;
  modulationContext: ModulationContext;
  executionPlanByDeviceId: ReadonlyMap<string, OperatorExecutionPlan>;
  mutedGroupIds: ReadonlySet<string>;
  mutedGeneratorIds: ReadonlySet<string>;
  referenceContext: MaskSourceReferenceContext;
}

export type RackOperatorInputPreparation = (
  state: MutableGenerationState,
  context: RackStageExecutionContext,
) => MutableGenerationState;

export interface PendingFrameApplicationOperatorInput {
  baseState: MutableGenerationState;
  sourceState: MutableGenerationState;
  precedingTemporalCheckpoint: PendingTemporalMaterializationCheckpoint | null;
}

export interface RackOperator {
  prepareInput: RackOperatorInputPreparation;
  execute(
    state: MutableGenerationState,
    stage: CompiledRackStage,
    context: RackStageExecutionContext,
  ): MutableGenerationState;
}

export type RackStageOfKind<TKind extends RackStageDeviceKind> = CompiledRackStage & {
  deviceKind: TKind;
  device: Extract<RackStageDeviceNode, { kind: TKind }>;
};

export type GeneratorStageKind = GeneratorNode['kind'];
export type SpatialTransformStageKind = Extract<GeneratorEffectNode['kind'], 'mirror' | 'rotate' | 'translate' | 'scale'>;

export const createRackOperator = <TKind extends RackStageDeviceKind>(
  prepareInput: RackOperatorInputPreparation,
  execute: (
    state: MutableGenerationState,
    stage: RackStageOfKind<TKind>,
    context: RackStageExecutionContext,
  ) => MutableGenerationState,
): RackOperator => ({
  prepareInput,
  execute: (state, stage, context) => execute(
    state,
    stage as RackStageOfKind<TKind>,
    context,
  ),
});

export interface OriginFrameRemap {
  nextTemporal: SceneTemporalState;
  sourceFrameIndexByOutputFrame: ReadonlyArray<number | null>;
  writeOrder: number;
}
