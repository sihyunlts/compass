import { normalizeOptionalId } from '../../../shared/normalize-id';
import { cloneDeviceNode, type GeneratorDeviceNode } from '../../../shared/model';
import {
  cloneDevicesWithFreshIds,
  remapInternalDeviceReferences,
} from './device-reference-remap';

export type RackClipboard =
  | {
      kind: 'devices';
      devices: GeneratorDeviceNode[];
    }
  | {
      kind: 'group';
      enabled: boolean;
      name: string | null;
      devices: GeneratorDeviceNode[];
    };

type ClipboardBuildOptions =
  | { kind: 'devices' }
  | { kind: 'group'; enabled: boolean; name: string | null };

type PreparedClipboardInsert = {
  devices: GeneratorDeviceNode[];
  forcedGroupId: string | null;
  groupStatePatch: { groupId: string; enabled: boolean; name: string | null } | null;
};

type PrepareClipboardInsertOptions = {
  allocateDeviceId: (kind: GeneratorDeviceNode['kind']) => string;
  resolveNextGroupId: () => string;
};

const cloneClipboardDevices = (
  devices: readonly GeneratorDeviceNode[],
): GeneratorDeviceNode[] => devices.map((device) => cloneDeviceNode(device));

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
      name: options.name,
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
  const { devices: cloned, idMap } = cloneDevicesWithFreshIds(
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
      remapInternalDeviceReferences(device, idMap, groupIdMap);
    }

    return {
      devices: cloned,
      forcedGroupId: nextGroupId,
      groupStatePatch: {
        groupId: nextGroupId,
        enabled: clipboard.enabled,
        name: clipboard.name,
      },
    };
  }

  for (const device of cloned) {
    remapInternalDeviceReferences(device, idMap);
  }

  return {
    devices: cloned,
    forcedGroupId: null,
    groupStatePatch: null,
  };
};
