import { normalizeOptionalId } from '../../../shared/normalize-id';
import {
  cloneAuthoredMetadata,
  cloneDeviceNode,
  type AuthoredMetadata,
  type GeneratorDeviceNode,
} from '../../../shared/model';
import {
  cloneDevicesWithFreshIds,
  remapInternalDeviceReferences,
  type UnresolvedReferencePolicy,
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
      metadata?: AuthoredMetadata;
      devices: GeneratorDeviceNode[];
    };

type ClipboardBuildOptions =
  | { kind: 'devices' }
  | {
      kind: 'group';
      enabled: boolean;
      name: string | null;
      metadata?: AuthoredMetadata;
    };

type PreparedClipboardInsert = {
  devices: GeneratorDeviceNode[];
  idMap: ReadonlyMap<string, string>;
  forcedGroupId: string | null;
  groupStatePatch: {
    groupId: string;
    enabled: boolean;
    name: string | null;
    metadata?: AuthoredMetadata;
  } | null;
};

type PrepareClipboardInsertOptions = {
  allocateDeviceId: (kind: GeneratorDeviceNode['kind']) => string;
  resolveNextGroupId: () => string;
  groupIdOverride?: string | null;
  unresolvedReferencePolicy?: UnresolvedReferencePolicy;
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
    const metadata = cloneAuthoredMetadata(options.metadata);
    return {
      kind: 'group',
      enabled: options.enabled,
      name: options.name,
      ...(metadata ? { metadata } : {}),
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
  const unresolvedReferencePolicy = options.unresolvedReferencePolicy ?? 'preserve';
  const { devices: cloned, idMap } = cloneDevicesWithFreshIds(
    clipboard.devices,
    options.allocateDeviceId,
  );

  if (clipboard.kind === 'group') {
    const nextGroupId =
      normalizeOptionalId(options.groupIdOverride) ?? options.resolveNextGroupId();
    const groupIdMap: Record<string, string> = {};
    for (const source of clipboard.devices) {
      const sourceGroupId = normalizeOptionalId(source.groupId);
      if (!sourceGroupId || groupIdMap[sourceGroupId]) {
        continue;
      }
      groupIdMap[sourceGroupId] = nextGroupId;
    }

    for (const device of cloned) {
      remapInternalDeviceReferences(
        device,
        idMap,
        groupIdMap,
        unresolvedReferencePolicy,
      );
    }

    const metadata = cloneAuthoredMetadata(clipboard.metadata);
    return {
      devices: cloned,
      idMap,
      forcedGroupId: nextGroupId,
      groupStatePatch: {
        groupId: nextGroupId,
        enabled: clipboard.enabled,
        name: clipboard.name,
        ...(metadata ? { metadata } : {}),
      },
    };
  }

  for (const device of cloned) {
    remapInternalDeviceReferences(
      device,
      idMap,
      undefined,
      unresolvedReferencePolicy,
    );
  }

  return {
    devices: cloned,
    idMap,
    forcedGroupId: null,
    groupStatePatch: null,
  };
};
