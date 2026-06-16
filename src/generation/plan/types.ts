import type { CanonicalAnalysisResult } from '../analysis/types';
import type { GeneratorChain, GeneratorDeviceNode } from '../../shared/model';

export type RackStageDeviceNode = Exclude<GeneratorDeviceNode, { kind: 'modulator' }>;
export type RackStageDeviceKind = RackStageDeviceNode['kind'];

export interface CompiledRackStage {
  stageId: string;
  stageIndex: number;
  deviceId: string;
  deviceKind: RackStageDeviceKind;
  groupId: string | null;
  device: RackStageDeviceNode;
}

export interface CompiledRackPlan {
  stages: CompiledRackStage[];
  baseChain: GeneratorChain;
  analysis: CanonicalAnalysisResult;
}
