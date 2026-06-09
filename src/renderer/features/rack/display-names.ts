import { getRendererDeviceLabel } from '../../../devices';
import {
  DEFAULT_GROUP_NAME_TEMPLATE,
  applyNameIndex,
  hasNameIndexToken,
  normalizeCustomName,
  type GeneratorChain,
  type GeneratorDeviceNode,
} from '../../../shared/model';
import { normalizeOptionalId } from '../../../shared/normalize-id';

type DisplayNameItem = {
  id: string;
  fallbackName: string;
  rawName: string | null;
};

const buildDisplayNameById = (
  items: readonly DisplayNameItem[],
): Record<string, string> => {
  const displayNameById: Record<string, string> = {};
  const nextIndexByTemplate = new Map<string, number>();

  for (const item of items) {
    if (!item.rawName) {
      displayNameById[item.id] = item.fallbackName;
      continue;
    }

    if (!hasNameIndexToken(item.rawName)) {
      displayNameById[item.id] = item.rawName;
      continue;
    }

    const nextIndex = (nextIndexByTemplate.get(item.rawName) ?? 0) + 1;
    nextIndexByTemplate.set(item.rawName, nextIndex);
    displayNameById[item.id] = applyNameIndex(item.rawName, nextIndex);
  }

  return displayNameById;
};

const collectOrderedGroupIds = (
  devices: readonly GeneratorDeviceNode[],
): string[] => {
  const orderedGroupIds: string[] = [];
  const seen = new Set<string>();

  for (const device of devices) {
    const groupId = normalizeOptionalId(device.groupId);
    if (!groupId || seen.has(groupId)) {
      continue;
    }

    seen.add(groupId);
    orderedGroupIds.push(groupId);
  }

  return orderedGroupIds;
};

const resolveStoredDeviceName = (
  device: Pick<GeneratorDeviceNode, 'name'>,
): string | null => normalizeCustomName(device.name);

export const resolveStoredGroupName = (
  groupStateById: GeneratorChain['groupStateById'],
  groupId: string,
): string | null => normalizeCustomName(groupStateById[groupId]?.name);

export const buildDeviceDisplayNameById = (
  devices: readonly GeneratorDeviceNode[],
): Record<string, string> => buildDisplayNameById(
  devices.map((device) => ({
    id: device.id,
    fallbackName: getRendererDeviceLabel(device.kind),
    rawName: resolveStoredDeviceName(device),
  })),
);

export const buildGroupDisplayNameById = (
  devices: readonly GeneratorDeviceNode[],
  groupStateById: GeneratorChain['groupStateById'],
): Record<string, string> => {
  const orderedGroupIds = collectOrderedGroupIds(devices);
  return buildDisplayNameById(
    orderedGroupIds.map((groupId) => ({
      id: groupId,
      fallbackName: groupId,
      rawName: resolveStoredGroupName(groupStateById, groupId)
        ?? DEFAULT_GROUP_NAME_TEMPLATE,
    })),
  );
};
