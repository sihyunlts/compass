import {
  getRendererDeviceLabel,
  type RendererDeviceKind,
} from '../../../devices';
import {
  DEFAULT_GROUP_NAME_TEMPLATE,
  applyNameIndex,
  hasNameIndexToken,
  normalizeCustomName,
  type GeneratorChain,
  type GeneratorDeviceNode,
} from '../../../shared/model';
import { buildOrderedGroupIds } from './layout';

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

const resolveStoredDeviceName = (
  device: Pick<GeneratorDeviceNode, 'name'>,
): string | null => normalizeCustomName(device.name);

export const resolveStoredGroupName = (
  groupStateById: GeneratorChain['groupStateById'],
  groupId: string,
): string | null => normalizeCustomName(groupStateById[groupId]?.name);

export const buildDeviceDisplayNameById = (
  devices: readonly GeneratorDeviceNode[],
  resolveFallbackName: (kind: RendererDeviceKind) => string = getRendererDeviceLabel,
): Record<string, string> => buildDisplayNameById(
  devices.map((device) => {
    const fallbackName = resolveFallbackName(device.kind);
    return {
      id: device.id,
      fallbackName,
      rawName: resolveStoredDeviceName(device) ?? `${fallbackName} #`,
    };
  }),
);

export const buildGroupDisplayNameById = (
  devices: readonly GeneratorDeviceNode[],
  groupStateById: GeneratorChain['groupStateById'],
  defaultNameTemplate: string = DEFAULT_GROUP_NAME_TEMPLATE,
): Record<string, string> => {
  const orderedGroupIds = buildOrderedGroupIds(devices);
  return buildDisplayNameById(
    orderedGroupIds.map((groupId) => ({
      id: groupId,
      fallbackName: groupId,
      rawName: resolveStoredGroupName(groupStateById, groupId)
        ?? defaultNameTemplate,
    })),
  );
};
