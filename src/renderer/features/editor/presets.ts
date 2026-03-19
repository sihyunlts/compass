import type {
  DevicePresetFile,
  GroupPresetFile,
  RackPresetFile,
} from '../../../shared/presets';
import {
  PRESET_FILE_SCHEMA_VERSION,
  toStandaloneDevicePresetDevice,
} from '../../../shared/presets';
import {
  cloneChainForIpc,
  cloneDeviceNode,
  sanitizeGeneratorChain,
  type GeneratorChain,
  type GeneratorDeviceNode,
} from '../../../shared/model';
import {
  buildDeviceDisplayNameById,
  buildGroupDisplayNameById,
} from '../rack/display-names';
import {
  applyInsertDevicesByDropZone,
  coerceOutsideTargetIdToGroupBoundaryByDevices,
  type RackDropZone,
} from '../rack/drop-ops';
import {
  createRackClipboard,
  prepareClipboardInsert,
} from './rack-clipboard';
import {
  reconcileGroupStateById,
  resolveGroupMemberIds,
  resolveNextGroupId,
  resolveDevicesByIds,
} from './chain-ops';
import { syncDeviceNodeIdSeeds } from './device-node-factory';

export type PresetApplyResult =
  | {
      ok: true;
      chain: GeneratorChain;
      message: string;
    }
  | {
      ok: false;
      message: string;
    };

export type GroupPresetReplaceResult =
  | {
      ok: true;
      chain: GeneratorChain;
      insertedDeviceIds: string[];
      message: string;
    }
  | {
      ok: false;
      message: string;
    };

const createSavedAtIso = (): string => new Date().toISOString();
const CLEAR_UNRESOLVED_IMPORT_REFERENCES = 'clear' as const;

const buildPreparedPresetInsert = (
  chain: GeneratorChain,
  preset: DevicePresetFile | GroupPresetFile,
  allocateDeviceId: (kind: GeneratorDeviceNode['kind']) => string,
  options: {
    groupIdOverride?: string | null;
  } = {},
) => {
  const clipboard = preset.presetType === 'group'
    ? createRackClipboard(preset.group.devices, {
      kind: 'group',
      enabled: preset.group.enabled,
      name: preset.group.name,
    })
    : createRackClipboard([preset.device], { kind: 'devices' });
  if (!clipboard) {
    return null;
  }

  return prepareClipboardInsert(clipboard, {
    allocateDeviceId,
    resolveNextGroupId: () => resolveNextGroupId(chain.devices),
    groupIdOverride: options.groupIdOverride,
    unresolvedReferencePolicy: CLEAR_UNRESOLVED_IMPORT_REFERENCES,
  });
};

const buildChainWithPreparedPresetInsert = (
  chain: GeneratorChain,
  dropZone: RackDropZone,
  prepared: ReturnType<typeof prepareClipboardInsert>,
): GeneratorChain => {
  const nextDevices = applyInsertDevicesByDropZone(
    chain.devices,
    prepared.devices,
    dropZone,
    prepared.groupStatePatch ? prepared.forcedGroupId : undefined,
  );
  const nextGroupStateById = reconcileGroupStateById(
    chain.groupStateById,
    nextDevices,
  );
  if (prepared.groupStatePatch) {
    nextGroupStateById[prepared.groupStatePatch.groupId] = {
      enabled: prepared.groupStatePatch.enabled,
      name: prepared.groupStatePatch.name,
    };
  }

  return sanitizeGeneratorChain({
    ...chain,
    devices: nextDevices,
    groupStateById: nextGroupStateById,
  });
};

const coerceGroupInsertDropZone = (
  chain: GeneratorChain,
  dropZone: RackDropZone,
): RackDropZone => {
  if (dropZone.kind === 'outside') {
    return dropZone;
  }

  return {
    kind: 'outside',
    targetId: coerceOutsideTargetIdToGroupBoundaryByDevices(
      chain.devices,
      dropZone.targetId,
      dropZone.placement,
    ),
    placement: dropZone.placement,
  };
};

export const resolveDevicePresetSuggestedName = (
  chain: GeneratorChain,
  deviceId: string,
): string => {
  const displayNameById = buildDeviceDisplayNameById(chain.devices);
  return displayNameById[deviceId] ?? 'Device Preset';
};

export const resolveGroupPresetSuggestedName = (
  chain: GeneratorChain,
  groupId: string,
): string => {
  const displayNameById = buildGroupDisplayNameById(
    chain.devices,
    chain.groupStateById,
  );
  return displayNameById[groupId] ?? groupId;
};

export const buildDevicePresetFile = (
  chain: GeneratorChain,
  deviceId: string,
): DevicePresetFile | null => {
  const device = chain.devices.find((item) => item.id === deviceId);
  if (!device) {
    return null;
  }

  return {
    schemaVersion: PRESET_FILE_SCHEMA_VERSION,
    presetType: 'device',
    savedAtIso: createSavedAtIso(),
    device: toStandaloneDevicePresetDevice(device),
  };
};

export const buildGroupPresetFile = (
  chain: GeneratorChain,
  groupId: string,
  memberDeviceIds: readonly string[],
): GroupPresetFile | null => {
  const devices = resolveDevicesByIds(chain.devices, memberDeviceIds);
  if (devices.length === 0) {
    return null;
  }

  return {
    schemaVersion: PRESET_FILE_SCHEMA_VERSION,
    presetType: 'group',
    savedAtIso: createSavedAtIso(),
    group: {
      enabled: chain.groupStateById[groupId]?.enabled !== false,
      name: chain.groupStateById[groupId]?.name ?? null,
      devices: devices.map((device) => cloneDeviceNode(device)),
    },
  };
};

export const buildRackPresetFile = (
  chain: GeneratorChain,
): RackPresetFile => ({
  schemaVersion: PRESET_FILE_SCHEMA_VERSION,
  presetType: 'rack',
  savedAtIso: createSavedAtIso(),
  chain: cloneChainForIpc(chain),
});

export const insertDevicePresetFile = (
  chain: GeneratorChain,
  dropZone: RackDropZone,
  preset: DevicePresetFile,
  allocateDeviceId: (kind: GeneratorDeviceNode['kind']) => string,
): PresetApplyResult => {
  const prepared = buildPreparedPresetInsert(chain, preset, allocateDeviceId);
  if (!prepared) {
    return {
      ok: false,
      message: 'Device preset could not be inserted.',
    };
  }

  return {
    ok: true,
    chain: buildChainWithPreparedPresetInsert(chain, dropZone, prepared),
    message: 'Device preset inserted.',
  };
};

export const insertGroupPresetFile = (
  chain: GeneratorChain,
  dropZone: RackDropZone,
  preset: GroupPresetFile,
  allocateDeviceId: (kind: GeneratorDeviceNode['kind']) => string,
): PresetApplyResult => {
  if (preset.group.devices.length === 0) {
    return {
      ok: false,
      message: 'Group preset does not contain any devices.',
    };
  }

  const prepared = buildPreparedPresetInsert(chain, preset, allocateDeviceId);
  if (!prepared) {
    return {
      ok: false,
      message: 'Group preset could not be inserted.',
    };
  }

  return {
    ok: true,
    chain: buildChainWithPreparedPresetInsert(
      chain,
      coerceGroupInsertDropZone(chain, dropZone),
      prepared,
    ),
    message: 'Group preset inserted.',
  };
};

export const replaceGroupPresetFile = (
  chain: GeneratorChain,
  groupId: string,
  preset: GroupPresetFile,
  allocateDeviceId: (kind: GeneratorDeviceNode['kind']) => string,
): GroupPresetReplaceResult => {
  const memberIds = resolveGroupMemberIds(chain.devices, groupId);
  if (memberIds.length === 0) {
    return {
      ok: false,
      message: 'Group preset could not be applied to this group.',
    };
  }

  if (preset.group.devices.length === 0) {
    return {
      ok: false,
      message: 'Group preset does not contain any devices.',
    };
  }

  const prepared = buildPreparedPresetInsert(chain, preset, allocateDeviceId, {
    groupIdOverride: groupId,
  });
  if (!prepared) {
    return {
      ok: false,
      message: 'Group preset could not be applied to this group.',
    };
  }

  const memberIdSet = new Set(memberIds);
  const replaceIndex = chain.devices.findIndex((device) => memberIdSet.has(device.id));
  if (replaceIndex < 0) {
    return {
      ok: false,
      message: 'Group preset could not be applied to this group.',
    };
  }

  const insertedDevices = prepared.devices.map((device) => ({
    ...device,
    groupId: prepared.forcedGroupId,
  }));
  const remainingDevices = chain.devices.filter((device) => !memberIdSet.has(device.id));
  const nextDevices = [...remainingDevices];
  nextDevices.splice(replaceIndex, 0, ...insertedDevices);

  const nextGroupStateById = reconcileGroupStateById(
    chain.groupStateById,
    nextDevices,
  );
  if (prepared.groupStatePatch) {
    nextGroupStateById[prepared.groupStatePatch.groupId] = {
      enabled: prepared.groupStatePatch.enabled,
      name: prepared.groupStatePatch.name,
    };
  }

  return {
    ok: true,
    chain: sanitizeGeneratorChain({
      ...chain,
      devices: nextDevices,
      groupStateById: nextGroupStateById,
    }),
    insertedDeviceIds: insertedDevices.map((device) => device.id),
    message: 'Group preset replaced.',
  };
};

export const applyRackPresetFile = (
  preset: RackPresetFile,
): PresetApplyResult => {
  syncDeviceNodeIdSeeds(preset.chain.devices);
  return {
    ok: true,
    chain: preset.chain,
    message: 'Rack preset loaded.',
  };
};
