import type { CanonicalAnalysisResult } from '../analysis/types';
import type { GeneratorChain, GeneratorDeviceNode } from '../../shared/model';

export interface CompiledRackStage {
  stageId: string;
  stageIndex: number;
  deviceId: string;
  deviceKind: GeneratorDeviceNode['kind'];
  groupId: string | null;
  reuseSignature: string;
  device: GeneratorDeviceNode;
}

export interface CompiledRackPlan {
  stages: CompiledRackStage[];
  baseChain: GeneratorChain;
  analysis: CanonicalAnalysisResult;
  modulationSignature: string;
}
