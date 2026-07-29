import type {
  DevicePresetFile,
  GroupPresetFile,
  RackPresetFile,
} from '../../../shared/presets';
import {
  getRendererDeviceLabel,
  type RendererDeviceKind,
} from '../../../devices';
import {
  PRESET_FILE_SCHEMA_VERSION,
  sanitizeCollapsedDeviceIdsForChain,
  sanitizeCollapsedDeviceIdsForDevices,
  toStandaloneDevicePresetDevice,
} from '../../../shared/presets';
import {
  cloneChainForIpc,
  cloneDeviceNode,
  type GeneratorChain,
  type GeneratorDeviceNode,
} from '../../../shared/model';
import { sanitizeGeneratorChain } from '../../../shared/model/chain-normalization';
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
  resolveNextGroupId,
  resolveDevicesByIds,
} from './chain-ops';
import { syncDeviceNodeIdSeeds } from './device-node-factory';

export type PresetApplyStatus =
  | 'device-insert-failed'
  | 'device-inserted'
  | 'group-insert-failed'
  | 'group-inserted'
  | 'rack-load-failed'
  | 'rack-loaded';

export type PresetApplyResult =
  | {
      ok: true;
      chain: GeneratorChain;
      status: 'device-inserted';
    }
  | {
      ok: false;
      status: 'device-insert-failed';
    };

export type GroupPresetApplyResult =
  | {
      ok: true;
      chain: GeneratorChain;
      groupId: string;
      collapsedDeviceIds: string[];
      status: 'group-inserted';
    }
  | {
      ok: false;
      status: 'group-insert-failed';
    };

export type RackPresetApplyResult =
  | {
      ok: true;
      chain: GeneratorChain;
      collapsedDeviceIds: string[];
      status: 'rack-loaded';
    }
  | {
      ok: false;
      status: 'rack-load-failed';
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

const remapCollapsedDeviceIds = (
  ids: readonly string[] | undefined,
  idMap: ReadonlyMap<string, string>,
): string[] => {
  if (!ids || ids.length === 0) {
    return [];
  }

  const remapped = new Set<string>();
  for (const id of ids) {
    const nextId = idMap.get(id);
    if (nextId) {
      remapped.add(nextId);
    }
  }

  return [...remapped];
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
  resolveFallbackName: (kind: RendererDeviceKind) => string = getRendererDeviceLabel,
): string => {
  const displayNameById = buildDeviceDisplayNameById(
    chain.devices,
    resolveFallbackName,
  );
  return displayNameById[deviceId] ?? 'Device';
};

export const resolveGroupPresetSuggestedName = (
  chain: GeneratorChain,
  groupId: string,
  defaultNameTemplate?: string,
): string => {
  const displayNameById = buildGroupDisplayNameById(
    chain.devices,
    chain.groupStateById,
    defaultNameTemplate,
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
  collapsedDeviceIds: readonly string[],
): GroupPresetFile | null => {
  const devices = resolveDevicesByIds(chain.devices, memberDeviceIds);
  if (devices.length === 0) {
    return null;
  }

  const sanitizedCollapsedDeviceIds = sanitizeCollapsedDeviceIdsForDevices(
    devices,
    collapsedDeviceIds,
  );

  return {
    schemaVersion: PRESET_FILE_SCHEMA_VERSION,
    presetType: 'group',
    savedAtIso: createSavedAtIso(),
    group: {
      enabled: chain.groupStateById[groupId]?.enabled !== false,
      name: chain.groupStateById[groupId]?.name ?? null,
      devices: devices.map((device) => cloneDeviceNode(device)),
    },
    ...(sanitizedCollapsedDeviceIds.length > 0
      ? {
          ui: {
            collapsedDeviceIds: sanitizedCollapsedDeviceIds,
          },
        }
      : {}),
  };
};

export const buildRackPresetFile = (
  chain: GeneratorChain,
  collapsedDeviceIds: readonly string[],
): RackPresetFile => {
  const clonedChain = cloneChainForIpc(chain);
  const sanitizedCollapsedDeviceIds = sanitizeCollapsedDeviceIdsForChain(
    clonedChain,
    collapsedDeviceIds,
  );

  return {
    schemaVersion: PRESET_FILE_SCHEMA_VERSION,
    presetType: 'rack',
    savedAtIso: createSavedAtIso(),
    chain: clonedChain,
    ...(sanitizedCollapsedDeviceIds.length > 0
      ? {
          ui: {
            collapsedDeviceIds: sanitizedCollapsedDeviceIds,
          },
        }
      : {}),
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
      status: 'device-insert-failed',
    };
  }

  return {
    ok: true,
    chain: buildChainWithPreparedPresetInsert(chain, dropZone, prepared),
    status: 'device-inserted',
  };
};

export const insertGroupPresetFile = (
  chain: GeneratorChain,
  dropZone: RackDropZone,
  preset: GroupPresetFile,
  allocateDeviceId: (kind: GeneratorDeviceNode['kind']) => string,
): GroupPresetApplyResult => {
  const prepared = buildPreparedPresetInsert(chain, preset, allocateDeviceId);
  if (!prepared) {
    return {
      ok: false,
      status: 'group-insert-failed',
    };
  }
  const groupId = prepared.groupStatePatch?.groupId ?? prepared.forcedGroupId;
  if (!groupId) {
    return {
      ok: false,
      status: 'group-insert-failed',
    };
  }

  return {
    ok: true,
    groupId,
    collapsedDeviceIds: remapCollapsedDeviceIds(
      preset.ui?.collapsedDeviceIds,
      prepared.idMap,
    ),
    chain: buildChainWithPreparedPresetInsert(
      chain,
      coerceGroupInsertDropZone(chain, dropZone),
      prepared,
    ),
    status: 'group-inserted',
  };
};

export const applyRackPresetFile = (
  preset: RackPresetFile,
): RackPresetApplyResult => {
  syncDeviceNodeIdSeeds(preset.chain.devices);
  const collapsedDeviceIds = sanitizeCollapsedDeviceIdsForChain(
    preset.chain,
    preset.ui?.collapsedDeviceIds,
  );
  return {
    ok: true,
    chain: preset.chain,
    collapsedDeviceIds,
    status: 'rack-loaded',
  };
};
