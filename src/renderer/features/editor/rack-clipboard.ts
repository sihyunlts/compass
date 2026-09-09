import { normalizeOptionalId } from '../../../shared/normalize-id';
import {
  cloneAuthoredMetadata,
  cloneDeviceNode,
  type AuthoredMetadata,
  type GeneratorDeviceNode,
  type GroupMode,
} from '../../../shared/model';
import {
  cloneDevicesWithFreshIds,
  remapInternalDeviceReferences,
  type UnresolvedReferencePolicy,
} from './device-reference-remap';

export interface RackClipboardGroupState {
  enabled: boolean;
  mode: GroupMode;
  name: string | null;
  metadata?: AuthoredMetadata;
}

export interface RackClipboard {
  kind: 'devices' | 'group' | 'rack-items';
  devices: GeneratorDeviceNode[];
  groupStateById: Record<string, RackClipboardGroupState>;
  collapsedDeviceIds: string[];
}

type ClipboardBuildOptions =
  | { kind: 'devices' }
  | ({ kind: 'group' } & RackClipboardGroupState)
  | {
      kind: 'rack-items';
      groupStateById: Readonly<Record<string, RackClipboardGroupState>>;
    };

export interface PreparedClipboardInsert {
  devices: GeneratorDeviceNode[];
  idMap: ReadonlyMap<string, string>;
  forcedGroupId: string | null;
  preservePreparedGroupIds: boolean;
  groupStatePatches: Array<RackClipboardGroupState & { groupId: string }>;
}

interface PrepareClipboardInsertOptions {
  allocateDeviceId: (kind: GeneratorDeviceNode['kind']) => string;
  resolveNextGroupId: () => string;
  allocateGroupId?: () => string;
  groupIdOverride?: string | null;
  unresolvedReferencePolicy?: UnresolvedReferencePolicy;
}

const cloneGroupState = (
  state: RackClipboardGroupState,
): RackClipboardGroupState => {
  const metadata = cloneAuthoredMetadata(state.metadata);
  return {
    enabled: state.enabled,
    mode: state.mode,
    name: state.name,
    ...(metadata ? { metadata } : {}),
  };
};

const cloneGroupStateById = (
  groupStateById: Readonly<Record<string, RackClipboardGroupState>>,
): Record<string, RackClipboardGroupState> => Object.fromEntries(
  Object.entries(groupStateById).map(([groupId, state]) => [
    groupId,
    cloneGroupState(state),
  ]),
);

export const createRackClipboard = (
  devices: readonly GeneratorDeviceNode[],
  options: ClipboardBuildOptions,
  collapsedDeviceIds: readonly string[] = [],
): RackClipboard | null => {
  if (devices.length === 0) {
    return null;
  }

  const deviceIdSet = new Set(devices.map((device) => device.id));
  let groupStateById: Record<string, RackClipboardGroupState> = {};
  if (options.kind === 'group') {
    for (const device of devices) {
      const groupId = normalizeOptionalId(device.groupId);
      if (groupId) {
        groupStateById[groupId] = cloneGroupState(options);
      }
    }
  } else if (options.kind === 'rack-items') {
    groupStateById = cloneGroupStateById(options.groupStateById);
  }

  return {
    kind: options.kind,
    devices: devices.map((device) => cloneDeviceNode(device)),
    groupStateById,
    collapsedDeviceIds: collapsedDeviceIds.filter((id) => deviceIdSet.has(id)),
  };
};

export const prepareClipboardInsert = (
  clipboard: RackClipboard,
  options: PrepareClipboardInsertOptions,
): PreparedClipboardInsert => {
  const unresolvedReferencePolicy = options.unresolvedReferencePolicy ?? 'preserve';
  const { devices, idMap } = cloneDevicesWithFreshIds(
    clipboard.devices,
    options.allocateDeviceId,
  );

  if (clipboard.kind === 'devices') {
    for (const device of devices) {
      remapInternalDeviceReferences(device, idMap, undefined, unresolvedReferencePolicy);
    }
    return {
      devices,
      idMap,
      forcedGroupId: null,
      preservePreparedGroupIds: false,
      groupStatePatches: [],
    };
  }

  const sourceGroupIds = Object.keys(clipboard.groupStateById);
  const groupIdMap: Record<string, string> = {};
  for (const sourceGroupId of sourceGroupIds) {
    groupIdMap[sourceGroupId] = clipboard.kind === 'group'
      ? normalizeOptionalId(options.groupIdOverride) ?? options.resolveNextGroupId()
      : options.allocateGroupId?.() ?? options.resolveNextGroupId();
  }

  for (let index = 0; index < devices.length; index += 1) {
    const sourceGroupId = normalizeOptionalId(clipboard.devices[index].groupId);
    devices[index].groupId = sourceGroupId ? groupIdMap[sourceGroupId] ?? null : null;
    remapInternalDeviceReferences(
      devices[index],
      idMap,
      groupIdMap,
      unresolvedReferencePolicy,
    );
  }

  const groupStatePatches = sourceGroupIds.map((sourceGroupId) => ({
    groupId: groupIdMap[sourceGroupId],
    ...cloneGroupState(clipboard.groupStateById[sourceGroupId]),
  }));
  return {
    devices,
    idMap,
    forcedGroupId: clipboard.kind === 'group' ? groupStatePatches[0]?.groupId ?? null : null,
    preservePreparedGroupIds: clipboard.kind === 'rack-items',
    groupStatePatches,
  };
};
