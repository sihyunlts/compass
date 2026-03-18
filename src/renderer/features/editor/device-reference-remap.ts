import { cloneDeviceNode, type GeneratorDeviceNode } from '../../../shared/model';
import { normalizeOptionalId } from '../../../shared/normalize-id';

type IdMap = ReadonlyMap<string, string>;
type GroupIdMap = Readonly<Record<string, string>>;
export type UnresolvedReferencePolicy = 'preserve' | 'clear';

export const cloneDevicesWithFreshIds = (
  devices: readonly GeneratorDeviceNode[],
  allocateId: (kind: GeneratorDeviceNode['kind']) => string,
): { devices: GeneratorDeviceNode[]; idMap: IdMap } => {
  const idMap = new Map<string, string>();
  const cloned = devices.map((device) => {
    const next = cloneDeviceNode(device);
    const nextId = allocateId(device.kind);
    idMap.set(device.id, nextId);
    next.id = nextId;
    return next;
  });

  return {
    devices: cloned,
    idMap,
  };
};

const readMappedGroupId = (
  id: string,
  map?: GroupIdMap,
): string | null => {
  if (!map) {
    return null;
  }

  const value = map[id];
  return typeof value === 'string' ? value : null;
};

export const remapInternalDeviceReferences = (
  device: GeneratorDeviceNode,
  idMap: IdMap,
  groupIdMap?: GroupIdMap,
  unresolvedReferencePolicy: UnresolvedReferencePolicy = 'preserve',
): void => {
  if (device.kind === 'modulator') {
    const target = device.params.target;
    if (!target) {
      return;
    }

    const remappedId = idMap.get(target.deviceId) ?? null;
    if (remappedId) {
      target.deviceId = remappedId;
      return;
    }

    if (unresolvedReferencePolicy === 'clear') {
      device.params.target = null;
    }

    return;
  }

  if (device.kind !== 'mask') {
    return;
  }

  const sourceId = normalizeOptionalId(device.params.sourceId);
  if (!sourceId) {
    return;
  }

  if (device.params.sourceKind === 'generator') {
    const remappedId = idMap.get(sourceId) ?? null;
    if (remappedId) {
      device.params.sourceId = remappedId;
      return;
    }

    if (unresolvedReferencePolicy === 'clear') {
      device.params.sourceId = null;
    }
    return;
  }

  if (device.params.sourceKind === 'group') {
    const remappedGroupId = readMappedGroupId(sourceId, groupIdMap);
    if (remappedGroupId) {
      device.params.sourceId = remappedGroupId;
      return;
    }

    if (unresolvedReferencePolicy === 'clear') {
      device.params.sourceId = null;
    }
  }
};
