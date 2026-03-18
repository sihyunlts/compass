import { normalizeColorDeviceParams } from '../../devices/color/schema';
import { reconcileGeneratorChainModulators } from '../../core/modulation/routing';
import { normalizeOptionalId } from '../normalize-id';
import type { GeneratorChain, GeneratorDeviceNode } from './chain';
import { cloneChainForIpc } from './chain-clone';
import { normalizeCustomName } from './naming';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

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

const reconcileMaskSourceIds = (chain: GeneratorChain): boolean => {
  const groupIds = collectActiveGroupIds(chain.devices);
  const generatorIds = collectGeneratorIds(chain.devices);
  let changed = false;

  for (const device of chain.devices) {
    if (device.kind !== 'mask') {
      continue;
    }

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
    changed = true;
  }

  return changed;
};

/** Clones and normalizes a chain loaded from persistence or preset files. */
export const sanitizeGeneratorChain = (
  chain: GeneratorChain,
): GeneratorChain => {
  const sanitized = cloneChainForIpc(chain);
  reconcileColorDeviceParams(sanitized);
  reconcileStoredNames(sanitized);
  reconcileMaskSourceIds(sanitized);
  reconcileGeneratorChainModulators(sanitized);
  return sanitized;
};
