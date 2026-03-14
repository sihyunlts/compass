import { normalizeCustomName } from '../../../shared/model/naming';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import type { GeneratorChain } from '../../../shared/model';
import { reconcileGroupStateById, withDevices } from './chain-ops';

export const renameDeviceById = (
  chain: GeneratorChain,
  deviceId: string,
  rawName: string,
): GeneratorChain | null => {
  const nextName = normalizeCustomName(rawName);
  let didChange = false;

  const nextDevices = chain.devices.map((device) => {
    if (device.id !== deviceId) {
      return device;
    }

    if (normalizeCustomName(device.name) === nextName) {
      return device;
    }

    didChange = true;
    return {
      ...device,
      name: nextName,
    };
  });

  if (!didChange) {
    return null;
  }

  return withDevices(chain, nextDevices);
};

export const renameGroupById = (
  chain: GeneratorChain,
  rawGroupId: string,
  rawName: string,
): GeneratorChain | null => {
  const groupId = normalizeOptionalId(rawGroupId);
  if (!groupId) {
    return null;
  }

  const hasGroup = chain.devices.some(
    (device) => normalizeOptionalId(device.groupId) === groupId,
  );
  if (!hasGroup) {
    return null;
  }

  const reconciledById = reconcileGroupStateById(chain.groupStateById, chain.devices);
  const nextName = normalizeCustomName(rawName);
  if (normalizeCustomName(reconciledById[groupId]?.name) === nextName) {
    return null;
  }

  return {
    ...chain,
    groupStateById: {
      ...reconciledById,
      [groupId]: {
        enabled: reconciledById[groupId]?.enabled !== false,
        name: nextName,
      },
    },
  };
};
