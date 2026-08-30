import { stripModulationDevicesFromChain } from '../../core/modulation/routing';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { cloneDeviceNode, isCurveModulatorNode, type GeneratorChain } from '../../shared/model';
import { normalizeOptionalId } from '../../shared/normalize-id';
import type { CompiledRackPlan, CompiledRackStage } from './types';

export const buildCompiledRackPlan = (
  chain: GeneratorChain,
): CompiledRackPlan => {
  const baseChain = stripModulationDevicesFromChain(chain);
  const stages: CompiledRackStage[] = [];

  for (const device of baseChain.devices) {
    if (!isDeviceEffectivelyEnabled(baseChain, device) || isCurveModulatorNode(device)) {
      continue;
    }

    const stageIndex = stages.length;
    const stage: CompiledRackStage = {
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
  };
};
