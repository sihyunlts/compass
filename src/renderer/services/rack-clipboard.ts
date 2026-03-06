import { normalizeOptionalId } from '../../shared/normalize-id';
import { cloneDeviceNode } from '../../shared/device-registry';
import type { GeneratorDeviceNode } from '../../shared/model';

export type RackClipboard =
  | {
      kind: 'devices';
      devices: GeneratorDeviceNode[];
    }
  | {
      kind: 'group';
      enabled: boolean;
      devices: GeneratorDeviceNode[];
    };

type IdMap = ReadonlyMap<string, string>;
type GroupIdMap = Readonly<Record<string, string>>;
type ClipboardBuildOptions =
  | { kind: 'devices' }
  | { kind: 'group'; enabled: boolean };

type PreparedClipboardInsert = {
  devices: GeneratorDeviceNode[];
  forcedGroupId: string | null;
  groupStatePatch: { groupId: string; enabled: boolean } | null;
};

type PrepareClipboardInsertOptions = {
  allocateDeviceId: (kind: GeneratorDeviceNode['kind']) => string;
  resolveNextGroupId: () => string;
};

const readMappedId = (
  id: string,
  map?: GroupIdMap,
): string | null => {
  if (!map) {
    return null;
  }

  const value = map[id];
  return typeof value === 'string' ? value : null;
};

const cloneClipboardDevices = (
  devices: readonly GeneratorDeviceNode[],
): GeneratorDeviceNode[] => devices.map((device) => cloneDeviceNode(device));

const cloneDevicesWithNewIds = (
  devices: readonly GeneratorDeviceNode[],
  allocateId: (kind: GeneratorDeviceNode['kind']) => string,
): { cloned: GeneratorDeviceNode[]; idMap: IdMap } => {
  const idMap = new Map<string, string>();
  const cloned = devices.map((device) => {
    const next = cloneDeviceNode(device);
    const nextId = allocateId(device.kind);
    idMap.set(device.id, nextId);
    next.id = nextId;
    return next;
  });

  return { cloned, idMap };
};

const remapInternalReferences = (
  device: GeneratorDeviceNode,
  idMap: IdMap,
  groupIdMap?: GroupIdMap,
): void => {
  if (device.kind === 'modulator') {
    const target = device.params.target;
    if (target) {
      const remappedId = idMap.get(target.deviceId) ?? null;
      if (remappedId) {
        target.deviceId = remappedId;
      }
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
    }
    return;
  }

  if (device.params.sourceKind === 'group') {
    const remappedGroupId = readMappedId(sourceId, groupIdMap);
    if (remappedGroupId) {
      device.params.sourceId = remappedGroupId;
    }
  }
};

export const createRackClipboard = (
  devices: readonly GeneratorDeviceNode[],
  options: ClipboardBuildOptions,
): RackClipboard | null => {
  const cloned = cloneClipboardDevices(devices);
  if (cloned.length === 0) {
    return null;
  }

  if (options.kind === 'group') {
    return {
      kind: 'group',
      enabled: options.enabled,
      devices: cloned,
    };
  }

  return {
    kind: 'devices',
    devices: cloned,
  };
};

export const prepareClipboardInsert = (
  clipboard: RackClipboard,
  options: PrepareClipboardInsertOptions,
): PreparedClipboardInsert => {
  const { cloned, idMap } = cloneDevicesWithNewIds(
    clipboard.devices,
    options.allocateDeviceId,
  );

  if (clipboard.kind === 'group') {
    const nextGroupId = options.resolveNextGroupId();
    const groupIdMap: Record<string, string> = {};
    for (const source of clipboard.devices) {
      const sourceGroupId = normalizeOptionalId(source.groupId);
      if (!sourceGroupId || groupIdMap[sourceGroupId]) {
        continue;
      }
      groupIdMap[sourceGroupId] = nextGroupId;
    }

    for (const device of cloned) {
      remapInternalReferences(device, idMap, groupIdMap);
    }

    return {
      devices: cloned,
      forcedGroupId: nextGroupId,
      groupStatePatch: {
        groupId: nextGroupId,
        enabled: clipboard.enabled,
      },
    };
  }

  for (const device of cloned) {
    remapInternalReferences(device, idMap);
  }

  return {
    devices: cloned,
    forcedGroupId: null,
    groupStatePatch: null,
  };
};
