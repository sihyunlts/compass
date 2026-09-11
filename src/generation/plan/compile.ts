import { stripModulationDevicesFromChain } from '../../core/modulation/routing';
import {
  isDeviceEffectivelyEnabled,
  resolveEffectTargetGroupId,
} from '../../shared/group-state';
import { cloneDeviceNode, type GeneratorChain } from '../../shared/model';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { CompiledRackPlan, CompiledRackStage } from './types';

export const buildCompiledRackPlan = (
  chain: GeneratorChain,
): CompiledRackPlan => {
  const baseChain = stripModulationDevicesFromChain(chain);
  const stages: CompiledRackStage[] = [];

  for (const device of baseChain.devices) {
    if (!isDeviceEffectivelyEnabled(baseChain, device)) {
      continue;
    }

    const stageIndex = stages.length;
    const memberGroupId = normalizeOptionalId(device.groupId);
    const stage: CompiledRackStage = {
      stageIndex,
      deviceId: device.id,
      deviceKind: device.kind,
      memberGroupId,
      targetGroupId: resolveEffectTargetGroupId(baseChain, memberGroupId),
      device: cloneDeviceNode(device),
    };
    stages.push(stage);
  }

  return {
    stages,
    baseChain,
  };
};
