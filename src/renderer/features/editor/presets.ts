import type {
  DevicePresetFile,
  GroupPresetFile,
  RackPresetFile,
} from '../../../shared/presets';
import {
  PRESET_FILE_SCHEMA_VERSION,
} from '../../../shared/presets';
import {
  cloneChainForIpc,
  cloneDeviceNode,
  hydrateImportedGeneratorChain,
  sanitizeGeneratorChain,
  type GeneratorChain,
  type GeneratorDeviceNode,
} from '../../../shared/model';
import type { RackPresetDropTargets } from '../../components/device-rack-types';
import {
  buildDeviceDisplayNameById,
  buildGroupDisplayNameById,
} from '../rack/display-names';
import {
  applyInsertDevicesByDropZone,
  coerceOutsideTargetIdToGroupBoundaryByDevices,
  type RackDropZone,
} from '../rack/drop-ops';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import {
  cloneDevicesWithFreshIds,
  remapInternalDeviceReferences,
} from './device-reference-remap';
import {
  createRackClipboard,
  prepareClipboardInsert,
} from './rack-clipboard';
import {
  reconcileGroupStateById,
  resolveNextGroupId,
  resolveDevicesByIds,
  resolveGroupMemberIds,
} from './chain-ops';

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

export type PresetDropIntent =
  | {
      kind: 'insert-device-preset';
      dropZone: RackDropZone;
      preset: DevicePresetFile;
    }
  | {
      kind: 'replace-device-preset';
      deviceId: string;
      preset: DevicePresetFile;
    }
  | {
      kind: 'insert-group-preset';
      dropZone: RackDropZone;
      preset: GroupPresetFile;
    }
  | {
      kind: 'replace-group-preset';
      groupId: string;
      preset: GroupPresetFile;
    };

type PresetDropIntentResult =
  | {
      ok: true;
      intent: PresetDropIntent;
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
    device: cloneDeviceNode(device),
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

export const applyDevicePresetFile = (
  chain: GeneratorChain,
  deviceId: string,
  preset: DevicePresetFile,
): PresetApplyResult => {
  const current = chain.devices.find((device) => device.id === deviceId) ?? null;
  if (!current) {
    return {
      ok: false,
      message: 'Selected device is no longer available.',
    };
  }

  if (current.kind !== preset.device.kind) {
    return {
      ok: false,
      message: 'Device preset kind does not match the selected device.',
    };
  }

  const nextDevices = chain.devices.map((device) => {
    if (device.id !== deviceId) {
      return device;
    }

    const cloned = cloneDeviceNode(preset.device);
    remapInternalDeviceReferences(
      cloned,
      new Map<string, string>(),
      undefined,
      CLEAR_UNRESOLVED_IMPORT_REFERENCES,
    );
    cloned.id = current.id;
    cloned.groupId = current.groupId ?? null;
    return cloned;
  });

  return {
    ok: true,
    chain: sanitizeGeneratorChain({
      ...chain,
      devices: nextDevices,
    }),
    message: 'Device preset loaded.',
  };
};

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

export const applyGroupPresetFile = (
  chain: GeneratorChain,
  groupId: string,
  preset: GroupPresetFile,
  allocateDeviceId: (kind: GeneratorDeviceNode['kind']) => string,
): PresetApplyResult => {
  const currentMemberIds = resolveGroupMemberIds(chain.devices, groupId);
  if (currentMemberIds.length === 0) {
    return {
      ok: false,
      message: 'Selected group is no longer available.',
    };
  }

  if (preset.group.devices.length === 0) {
    return {
      ok: false,
      message: 'Group preset does not contain any devices.',
    };
  }

  const firstIndex = chain.devices.findIndex((device) => device.id === currentMemberIds[0]);
  const remainingDevices = chain.devices.filter(
    (device) => !currentMemberIds.includes(device.id),
  );
  const { devices: clonedDevices, idMap } = cloneDevicesWithFreshIds(
    preset.group.devices,
    allocateDeviceId,
  );
  const groupIdMap: Record<string, string> = {};
  for (const source of preset.group.devices) {
    const sourceGroupId = normalizeOptionalId(source.groupId);
    if (!sourceGroupId) {
      continue;
    }

    groupIdMap[sourceGroupId] = groupId;
  }

  for (const device of clonedDevices) {
    remapInternalDeviceReferences(
      device,
      idMap,
      groupIdMap,
      CLEAR_UNRESOLVED_IMPORT_REFERENCES,
    );
    device.groupId = groupId;
  }

  const nextDevices = [...remainingDevices];
  nextDevices.splice(firstIndex, 0, ...clonedDevices);
  const nextGroupStateById = reconcileGroupStateById(
    chain.groupStateById,
    nextDevices,
  );
  nextGroupStateById[groupId] = {
    enabled: preset.group.enabled,
    name: preset.group.name,
  };

  return {
    ok: true,
    chain: sanitizeGeneratorChain({
      ...chain,
      devices: nextDevices,
      groupStateById: nextGroupStateById,
    }),
    message: 'Group preset loaded.',
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

export const applyRackPresetFile = (
  preset: RackPresetFile,
): PresetApplyResult => {
  const chain = hydrateImportedGeneratorChain(preset.chain);
  if (!chain) {
    return {
      ok: false,
      message: 'Rack preset data is invalid.',
    };
  }

  return {
    ok: true,
    chain,
    message: 'Rack preset loaded.',
  };
};

export const resolvePresetDropIntent = (
  chain: GeneratorChain,
  targets: RackPresetDropTargets,
  preset: DevicePresetFile | GroupPresetFile,
): PresetDropIntentResult => {
  if (preset.presetType === 'device') {
    const hoveredDevice = targets.hoveredDeviceId
      ? chain.devices.find((device) => device.id === targets.hoveredDeviceId) ?? null
      : null;
    if (hoveredDevice && hoveredDevice.kind === preset.device.kind) {
      return {
        ok: true,
        intent: {
          kind: 'replace-device-preset',
          deviceId: hoveredDevice.id,
          preset,
        },
      };
    }

    if (!targets.dropZone) {
      return {
        ok: false,
        message: 'Drop the preset onto the rack to load it.',
      };
    }

    return {
      ok: true,
      intent: {
        kind: 'insert-device-preset',
        dropZone: targets.dropZone,
        preset,
      },
    };
  }

  const hoveredGroupId = normalizeOptionalId(targets.hoveredGroupId);
  if (hoveredGroupId && resolveGroupMemberIds(chain.devices, hoveredGroupId).length > 0) {
    return {
      ok: true,
      intent: {
        kind: 'replace-group-preset',
        groupId: hoveredGroupId,
        preset,
      },
    };
  }

  if (!targets.dropZone) {
    return {
      ok: false,
      message: 'Drop the preset onto the rack to load it.',
    };
  }

  return {
    ok: true,
    intent: {
      kind: 'insert-group-preset',
      dropZone: targets.dropZone,
      preset,
    },
  };
};
