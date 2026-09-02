import type { CompiledModulationProgram } from '../../../core/modulation/compiled-program';
import type {
  GeneratorDeviceNode,
  GeneratorEffectNode,
  GeneratorNode,
} from '../../../shared/model';
import type { SpatialRequirement } from '../../analysis/types';
import type {
  CompiledRackPlan,
  CompiledRackStage,
  RackStageDeviceKind,
  RackStageDeviceNode,
} from '../../plan/types';
import type {
  DeferredGenerationState,
  MaterializedGenerationState,
  MutableGenerationState,
} from '../../timeline/state';
import type { CanonicalOutputAdapter, GeometryTimeline } from '../../types';

export interface ModulationContext {
  loopLengthBeats: number;
  program: CompiledModulationProgram;
  deviceByFrameKey: Map<string, GeneratorDeviceNode>;
}

export interface MaskSourceReferenceContext {
  compiledPlan: CompiledRackPlan;
  sampleStepBeats: number;
  outputAdapter: CanonicalOutputAdapter;
  modulationContext: ModulationContext;
  generatorOutputBounds: SpatialRequirement;
  mutedGroupIds: ReadonlySet<string>;
  mutedGeneratorIds: ReadonlySet<string>;
  timelineBySourceKey: Map<string, GeometryTimeline>;
  resolvingSourceKeys: Set<string>;
  resolveReference(request: MaskSourceReferenceRequest): MaskSourceReferenceResult;
}

export interface MaskSourceReferenceRequest {
  sourceKind: 'group' | 'generator';
  sourceId: string | null;
}

export type MaskSourceReferenceResult =
  | { status: 'resolved'; timeline: GeometryTimeline }
  | { status: 'unconfigured' }
  | { status: 'cycle' };

export interface RackStageExecutionContext {
  compiledPlan: CompiledRackPlan;
  outputAdapter: CanonicalOutputAdapter;
  modulationContext: ModulationContext;
  generatorOutputBounds: SpatialRequirement;
  mutedGroupIds: ReadonlySet<string>;
  mutedGeneratorIds: ReadonlySet<string>;
  referenceContext: MaskSourceReferenceContext;
}

export type RackOperatorInputPolicy = 'preserve-pending' | 'materialize-all';

export type RackOperatorInput<TPolicy extends RackOperatorInputPolicy> =
  TPolicy extends 'materialize-all'
    ? MaterializedGenerationState
    : MutableGenerationState;

export interface PendingFrameApplicationOperatorInput {
  baseState: DeferredGenerationState;
  sourceState: MaterializedGenerationState;
}

export interface RackOperatorContract<TPolicy extends RackOperatorInputPolicy> {
  inputPolicy: TPolicy;
  execute(
    state: RackOperatorInput<TPolicy>,
    stage: CompiledRackStage,
    context: RackStageExecutionContext,
  ): MutableGenerationState;
}

export type RackOperator =
  | RackOperatorContract<'preserve-pending'>
  | RackOperatorContract<'materialize-all'>;

export type RackStageOfKind<TKind extends RackStageDeviceKind> = CompiledRackStage & {
  deviceKind: TKind;
  device: Extract<RackStageDeviceNode, { kind: TKind }>;
};

export type GeneratorStageKind = GeneratorNode['kind'];
export type SpatialTransformStageKind = Extract<GeneratorEffectNode['kind'], 'mirror' | 'rotate' | 'translate' | 'scale'>;

export const createRackOperator = <
  TKind extends RackStageDeviceKind,
  TPolicy extends RackOperatorInputPolicy,
>(
  inputPolicy: TPolicy,
  execute: (
    state: RackOperatorInput<TPolicy>,
    stage: RackStageOfKind<TKind>,
    context: RackStageExecutionContext,
  ) => MutableGenerationState,
): RackOperatorContract<TPolicy> => ({
  inputPolicy,
  execute: (state, stage, context) => execute(
    state,
    stage as RackStageOfKind<TKind>,
    context,
  ),
});

export interface OriginFrameRemap {
  sourceFrameIndexByOutputFrame: ReadonlyArray<number | null>;
  writeOrder: number;
}
