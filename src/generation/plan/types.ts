import type { CanonicalAnalysisResult } from '../analysis/types';
import type { GeneratorChain, GeneratorDeviceNode } from '../../shared/model';

export interface CompiledRackStage {
  stageId: string;
  stageIndex: number;
  deviceId: string;
  deviceKind: GeneratorDeviceNode['kind'];
  groupId: string | null;
  device: GeneratorDeviceNode;
}

export interface CompiledRackPlan {
  stages: CompiledRackStage[];
  baseChain: GeneratorChain;
  analysis: CanonicalAnalysisResult;
}
