import {
  hydrateImportedRendererDeviceNode,
  isRendererDeviceKind,
} from '../../devices/schema-registry';
import { normalizeColorDeviceParams } from '../../devices/color/schema';
import { reconcileGeneratorChainModulators } from '../../core/modulation/routing';
import { normalizeOptionalId } from '../normalize-id';
import type {
  GeneratorChain,
  GeneratorDeviceNode,
} from './chain';
import { cloneChainForIpc } from './chain-clone';
import { normalizeCustomName, normalizeRackName } from './naming';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

export const hydrateImportedGeneratorDevice = (
  value: unknown,
): GeneratorDeviceNode | null => {
  if (!isRecord(value)) {
    return null;
  }

  const kind = typeof value.kind === 'string' && isRendererDeviceKind(value.kind)
    ? value.kind
    : null;
  if (!kind) {
    return null;
  }

  return hydrateImportedRendererDeviceNode(kind, value);
};

export interface HydratedGeneratorDevicesResult {
  devices: GeneratorDeviceNode[];
  invalidDeviceCount: number;
}

export type ImportedDataMode = 'strict' | 'recover';

export const formatInvalidHydratedDeviceWarning = (
  invalidDeviceCount: number,
  action: string,
): string | undefined =>
  invalidDeviceCount > 0
    ? `Skipped ${invalidDeviceCount} invalid ${invalidDeviceCount === 1 ? 'device' : 'devices'} while ${action}.`
    : undefined;

export const hydrateImportedGeneratorDevices = (
  value: unknown,
  options: {
    mode?: ImportedDataMode;
  } = {},
): HydratedGeneratorDevicesResult | null => {
  const mode = options.mode ?? 'recover';
  if (!Array.isArray(value)) {
    return null;
  }

  const devices: GeneratorDeviceNode[] = [];
  const seenIds = new Set<string>();
  let invalidDeviceCount = 0;
  for (const device of value) {
    const hydrated = hydrateImportedGeneratorDevice(device);
    if (!hydrated) {
      invalidDeviceCount += 1;
      if (mode === 'strict') {
        return null;
      }
      continue;
    }

    if (seenIds.has(hydrated.id)) {
      invalidDeviceCount += 1;
      if (mode === 'strict') {
        return null;
      }
      continue;
    }

    seenIds.add(hydrated.id);
    devices.push(hydrated);
  }

  return {
    devices,
    invalidDeviceCount,
  };
};

const hydrateImportedGroupStateById = (
  value: unknown,
): GeneratorChain['groupStateById'] => {
  if (!isRecord(value)) {
    return {};
  }

  const next: GeneratorChain['groupStateById'] = {};
  for (const [rawGroupId, rawState] of Object.entries(value)) {
    const groupId = normalizeOptionalId(rawGroupId);
    if (!groupId) {
      continue;
    }

    const state = isRecord(rawState) ? rawState : {};
    next[groupId] = {
      enabled: toBoolean(state.enabled, true),
      name: normalizeCustomName(state.name),
    };
  }

  return next;
};

const collectActiveGroupIds = (
  devices: readonly GeneratorDeviceNode[],
): Set<string> => {
  const ids = new Set<string>();
  for (const device of devices) {
    const groupId = normalizeOptionalId(device.groupId);
    if (groupId) {
      ids.add(groupId);
    }
  }
  return ids;
};

const collectGeneratorIds = (
  devices: readonly GeneratorDeviceNode[],
): Set<string> => {
  const ids = new Set<string>();
  for (const device of devices) {
    if (
      device.kind === 'waterdrop'
      || device.kind === 'scanner'
      || device.kind === 'spiral'
    ) {
      ids.add(device.id);
    }
  }
  return ids;
};

export const reconcileChainGroupStateById = (
  prev: GeneratorChain['groupStateById'],
  devices: readonly GeneratorDeviceNode[],
): GeneratorChain['groupStateById'] => {
  const activeGroupIds = collectActiveGroupIds(devices);
  const next: GeneratorChain['groupStateById'] = {};

  for (const groupId of activeGroupIds) {
    const prevEntry: Record<string, unknown> = isRecord(prev[groupId])
      ? prev[groupId]
      : {};
    next[groupId] = {
      enabled: toBoolean(prevEntry.enabled, true),
      name: normalizeCustomName(prevEntry.name),
    };
  }

  return next;
};

const reconcileStoredNames = (chain: GeneratorChain): void => {
  for (const device of chain.devices) {
    device.name = normalizeCustomName((device as { name?: unknown }).name);
  }

  chain.groupStateById = reconcileChainGroupStateById(
    chain.groupStateById,
    chain.devices,
  );
};

const reconcileColorDeviceParams = (chain: GeneratorChain): void => {
  for (const device of chain.devices) {
    if (device.kind !== 'color') {
      continue;
    }

    device.params = normalizeColorDeviceParams(device.params);
  }
};

const reconcileMaskSourceIds = (chain: GeneratorChain): void => {
  const groupIds = collectActiveGroupIds(chain.devices);
  const generatorIds = collectGeneratorIds(chain.devices);

  for (const device of chain.devices) {
    if (device.kind !== 'mask') {
      continue;
    }

    device.params.sourceDomain = device.params.sourceDomain === 'scene'
      ? 'scene'
      : 'activation';

    const prevSourceId = normalizeOptionalId(device.params.sourceId);
    let nextSourceId: string | null = null;

    if (device.params.sourceKind === 'group') {
      nextSourceId = prevSourceId && groupIds.has(prevSourceId) ? prevSourceId : null;
    } else if (device.params.sourceKind === 'generator') {
      nextSourceId = prevSourceId && generatorIds.has(prevSourceId) ? prevSourceId : null;
    }

    if (prevSourceId === nextSourceId) {
      continue;
    }

    device.params.sourceId = nextSourceId;
  }
};

/** Clones and normalizes a chain loaded from persistence or preset files. */
export const sanitizeGeneratorChain = (
  chain: GeneratorChain,
): GeneratorChain => {
  const sanitized = cloneChainForIpc(chain);
  sanitized.name = normalizeRackName((chain as { name?: unknown }).name);
  reconcileColorDeviceParams(sanitized);
  reconcileStoredNames(sanitized);
  reconcileMaskSourceIds(sanitized);
  reconcileGeneratorChainModulators(sanitized);
  return sanitized;
};

export interface HydratedGeneratorChainResult {
  chain: GeneratorChain;
  invalidDeviceCount: number;
}

/** Validates and hydrates an externally loaded chain into a runtime-safe shape. */
export const hydrateImportedGeneratorChain = (
  value: unknown,
  options: {
    mode?: ImportedDataMode;
  } = {},
): HydratedGeneratorChainResult | null => {
  const mode = options.mode ?? 'recover';
  if (!isRecord(value) || !Array.isArray(value.devices)) {
    return null;
  }
  if (mode === 'strict' && !isRecord(value.groupStateById)) {
    return null;
  }

  const hydratedDevices = hydrateImportedGeneratorDevices(value.devices, { mode });
  if (!hydratedDevices) {
    return null;
  }

  return {
    chain: sanitizeGeneratorChain({
      name: normalizeRackName(value.name),
      devices: hydratedDevices.devices,
      groupStateById: hydrateImportedGroupStateById(value.groupStateById),
    }),
    invalidDeviceCount: hydratedDevices.invalidDeviceCount,
  };
};
