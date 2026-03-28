import { buildCanonicalAnalysisResult } from '../analysis/operators';
import { stripModulationDevicesFromChain } from '../../core/modulation/routing';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { cloneDeviceNode } from '../../shared/model';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { CompiledRackPlan, CompiledRackStage } from './types';

const buildStageId = (
  stageIndex: number,
  deviceId: string,
): string => `stage:${stageIndex}:${deviceId}`;

export const buildCompiledRackPlan = (
  chain: CompiledRackPlan['baseChain'],
  loopLengthBeats: number,
): CompiledRackPlan => {
  void loopLengthBeats;
  const baseChain = stripModulationDevicesFromChain(chain);
  const stages: CompiledRackStage[] = [];

  for (const device of baseChain.devices) {
    if (!isDeviceEffectivelyEnabled(baseChain, device) || device.kind === 'modulator') {
      continue;
    }

    const stageIndex = stages.length;
    const stage: CompiledRackStage = {
      stageId: buildStageId(stageIndex, device.id),
      stageIndex,
      deviceId: device.id,
      deviceKind: device.kind,
      groupId: normalizeOptionalId(device.groupId),
      device: cloneDeviceNode(device),
    };
    stages.push(stage);
  }

  return {
    stages,
    baseChain,
    analysis: buildCanonicalAnalysisResult(baseChain),
  };
};
