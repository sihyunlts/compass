import { normalizeOptionalId } from '../../shared/normalize-id';
import type { GeneratorChain, GeneratorDeviceNode } from '../../shared/types';

const collectActiveGroupIds = (
  devices: readonly GeneratorDeviceNode[],
): Set<string> => {
  const ids = new Set<string>();
  for (const device of devices) {
    const groupId = normalizeOptionalId(device.groupId);
    if (!groupId) {
      continue;
    }
    ids.add(groupId);
  }
  return ids;
};

export const reconcileGroupStateById = (
  prev: GeneratorChain['groupStateById'],
  devices: readonly GeneratorDeviceNode[],
): GeneratorChain['groupStateById'] => {
  const activeGroupIds = collectActiveGroupIds(devices);
  const next: GeneratorChain['groupStateById'] = {};

  for (const groupId of activeGroupIds) {
    next[groupId] = {
      enabled: prev[groupId]?.enabled !== false,
    };
  }

  return next;
};

export const withDevices = (
  chain: GeneratorChain,
  devices: GeneratorDeviceNode[],
): GeneratorChain => ({
  ...chain,
  devices,
  groupStateById: reconcileGroupStateById(chain.groupStateById, devices),
});

export const removeDevicesById = (
  chainState: GeneratorChain,
  deviceIds: readonly string[],
): GeneratorChain | null => {
  const toDelete = new Set(deviceIds);
  if (toDelete.size === 0) {
    return null;
  }

  const nextDevices = chainState.devices.filter((device) => !toDelete.has(device.id));
  if (nextDevices.length === chainState.devices.length) {
    return null;
  }

  return withDevices(chainState, nextDevices);
};
