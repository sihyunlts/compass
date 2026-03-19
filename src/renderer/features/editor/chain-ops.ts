import { normalizeOptionalId } from '../../../shared/normalize-id';
import {
  type GeneratorChain,
  type GeneratorDeviceNode,
} from '../../../shared/model';
import { reconcileChainGroupStateById } from '../../../shared/model/chain-normalization';

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
  return reconcileChainGroupStateById(prev, devices);
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

export const resolveNextGroupId = (
  devices: readonly GeneratorDeviceNode[],
): string => {
  const existing = collectActiveGroupIds(devices);
  let index = 1;
  while (existing.has(`group-${index}`)) {
    index += 1;
  }
  return `group-${index}`;
};

export const assignGroupIdToDevices = (
  chainState: GeneratorChain,
  deviceIds: readonly string[],
  groupId: string | null,
): GeneratorChain | null => {
  const targetIds = new Set(deviceIds);
  if (targetIds.size === 0) {
    return null;
  }

  let didChange = false;
  const nextGroupId = groupId;
  const nextDevices = chainState.devices.map((device) => {
    if (!targetIds.has(device.id)) {
      return device;
    }

    const currentGroupId = device.groupId ?? null;
    if (currentGroupId === nextGroupId) {
      return device;
    }

    didChange = true;
    return {
      ...device,
      groupId: nextGroupId,
    };
  });

  if (!didChange) {
    return null;
  }

  return withDevices(chainState, nextDevices);
};

export const canCreateGroupFromSelection = (
  devices: readonly GeneratorDeviceNode[],
  deviceIds: readonly string[],
): boolean => {
  if (deviceIds.length === 0) {
    return false;
  }

  const byId = new Map(
    devices.map((device): [string, GeneratorDeviceNode] => [device.id, device]),
  );
  for (const id of deviceIds) {
    const device = byId.get(id);
    if (!device || normalizeOptionalId(device.groupId)) {
      return false;
    }
  }
  return true;
};

export const resolveGroupMemberIds = (
  devices: readonly GeneratorDeviceNode[],
  rawGroupId: string,
): string[] => {
  const groupId = normalizeOptionalId(rawGroupId);
  if (!groupId) {
    return [];
  }

  return devices
    .filter((device) => normalizeOptionalId(device.groupId) === groupId)
    .map((device) => device.id);
};

export const resolveExistingOrderedDeviceIds = (
  devices: readonly GeneratorDeviceNode[],
  deviceIds: readonly string[],
): string[] => {
  const targetIds = new Set(deviceIds);
  return devices
    .filter((device) => targetIds.has(device.id))
    .map((device) => device.id);
};

export const resolveDevicesByIds = (
  devices: readonly GeneratorDeviceNode[],
  deviceIds: readonly string[],
): GeneratorDeviceNode[] => {
  if (deviceIds.length === 0) {
    return [];
  }

  const byId = new Map(
    devices.map((device): [string, GeneratorDeviceNode] => [device.id, device]),
  );
  const resolved: GeneratorDeviceNode[] = [];
  for (const id of deviceIds) {
    const device = byId.get(id);
    if (device) {
      resolved.push(device);
    }
  }
  return resolved;
};

export const resolveTailDeviceIdByGroup = (
  devices: readonly GeneratorDeviceNode[],
  rawGroupId: string,
): string | null => {
  const groupId = normalizeOptionalId(rawGroupId);
  if (!groupId) {
    return null;
  }

  let lastDeviceId: string | null = null;
  for (const device of devices) {
    if (normalizeOptionalId(device.groupId) === groupId) {
      lastDeviceId = device.id;
    }
  }
  return lastDeviceId;
};

export const resolveCommonGroupId = (
  devices: readonly GeneratorDeviceNode[],
  deviceIds: readonly string[],
): string | null => {
  let commonGroupId: string | null | undefined = undefined;
  const byId = new Map(
    devices.map((device): [string, GeneratorDeviceNode] => [device.id, device]),
  );

  for (const deviceId of deviceIds) {
    const device = byId.get(deviceId);
    if (!device) {
      return null;
    }

    const groupId = normalizeOptionalId(device.groupId);
    if (commonGroupId === undefined) {
      commonGroupId = groupId;
      continue;
    }

    if (commonGroupId !== groupId) {
      return null;
    }
  }

  return commonGroupId ?? null;
};
