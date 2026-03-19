import {
  createRendererDeviceNode,
  isRendererDeviceKind,
} from '../../devices/schema-registry';
import { normalizeColorDeviceParams } from '../../devices/color/schema';
import type { RendererDeviceKind } from '../../devices/types';
import { sanitizeModulationCurve } from '../../core/modulation/curve';
import { reconcileGeneratorChainModulators } from '../../core/modulation/routing';
import { sanitizeModulationTarget } from '../../core/modulation/routing';
import { normalizeOptionalId } from '../normalize-id';
import type {
  ColorEffectNode,
  CurveModulatorNode,
  GeneratorChain,
  GeneratorDeviceNode,
  MaskEffectNode,
  MirrorEffectNode,
  RotateEffectNode,
  ScannerGeneratorNode,
  SpiralGeneratorNode,
  SymmetryEffectNode,
  WaterdropGeneratorNode,
} from './chain';
import { cloneChainForIpc } from './chain-clone';
import { normalizeCustomName } from './naming';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;

const toFiniteNumber = (value: unknown, fallback: number): number => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
};

const toIntegerArray = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const next: number[] = [];
  for (const item of value) {
    const numeric = Number(item);
    if (Number.isInteger(numeric)) {
      next.push(numeric);
    }
  }

  return next;
};

const applyImportedDeviceMeta = <T extends GeneratorDeviceNode>(
  device: T,
  source: Record<string, unknown>,
): T => {
  device.groupId = normalizeOptionalId(source.groupId as string | null | undefined);
  device.name = normalizeCustomName(source.name);
  return device;
};

const createImportedDeviceNode = (
  kind: RendererDeviceKind,
  source: Record<string, unknown>,
): GeneratorDeviceNode | null => {
  const id = normalizeOptionalId(source.id as string | null | undefined);
  if (!id) {
    return null;
  }

  const enabled = toBoolean(source.enabled, true);
  const params = isRecord(source.params) ? source.params : {};

  if (kind === 'waterdrop') {
    const device = applyImportedDeviceMeta(
      createRendererDeviceNode(kind, id, enabled) as WaterdropGeneratorNode,
      source,
    );
    device.params.centerX = toFiniteNumber(params.centerX, device.params.centerX);
    device.params.centerY = toFiniteNumber(params.centerY, device.params.centerY);
    device.params.curvature = toFiniteNumber(params.curvature, device.params.curvature);
    device.params.startRadius = toFiniteNumber(params.startRadius, device.params.startRadius);
    return device;
  }

  if (kind === 'scanner') {
    const device = applyImportedDeviceMeta(
      createRendererDeviceNode(kind, id, enabled) as ScannerGeneratorNode,
      source,
    );
    device.params.angleDeg = toFiniteNumber(params.angleDeg, device.params.angleDeg);
    device.params.startOffset = toFiniteNumber(params.startOffset, device.params.startOffset);
    return device;
  }

  if (kind === 'spiral') {
    const device = applyImportedDeviceMeta(
      createRendererDeviceNode(kind, id, enabled) as SpiralGeneratorNode,
      source,
    );
    device.params.centerX = toFiniteNumber(params.centerX, device.params.centerX);
    device.params.centerY = toFiniteNumber(params.centerY, device.params.centerY);
    device.params.turns = toFiniteNumber(params.turns, device.params.turns);
    device.params.startRadius = toFiniteNumber(params.startRadius, device.params.startRadius);
    return device;
  }

  if (kind === 'mirror') {
    const device = applyImportedDeviceMeta(
      createRendererDeviceNode(kind, id, enabled) as MirrorEffectNode,
      source,
    );
    device.params.angleDeg = toFiniteNumber(params.angleDeg, device.params.angleDeg);
    return device;
  }

  if (kind === 'symmetry') {
    const device = applyImportedDeviceMeta(
      createRendererDeviceNode(kind, id, enabled) as SymmetryEffectNode,
      source,
    );
    device.params.mode = params.mode === 'quad-mirror'
      || params.mode === 'quad-pinwheel'
      || params.mode === 'mirror-half'
      ? params.mode
      : device.params.mode;
    device.params.axis = params.axis === 'vertical' ? 'vertical' : 'horizontal';
    device.params.sourceAnchor = params.sourceAnchor === 'br'
      || params.sourceAnchor === 'tr'
      || params.sourceAnchor === 'tl'
      ? params.sourceAnchor
      : 'bl';
    return device;
  }

  if (kind === 'mask') {
    const device = applyImportedDeviceMeta(
      createRendererDeviceNode(kind, id, enabled) as MaskEffectNode,
      source,
    );
    device.params.mode = params.mode === 'exclude' ? 'exclude' : 'include';
    device.params.tiles = toIntegerArray(params.tiles);
    device.params.sourceKind = params.sourceKind === 'group'
      || params.sourceKind === 'generator'
      || params.sourceKind === 'tiles'
      ? params.sourceKind
      : device.params.sourceKind;
    device.params.sourceVisibility = params.sourceVisibility === 'show' ? 'show' : 'hide';
    device.params.sourceId = device.params.sourceKind === 'tiles'
      ? null
      : normalizeOptionalId(params.sourceId as string | null | undefined);
    return device;
  }

  if (kind === 'rotate') {
    const device = applyImportedDeviceMeta(
      createRendererDeviceNode(kind, id, enabled) as RotateEffectNode,
      source,
    );
    device.params.angleDeg = toFiniteNumber(params.angleDeg, device.params.angleDeg);
    return device;
  }

  if (kind === 'reverse') {
    return applyImportedDeviceMeta(
      createRendererDeviceNode(kind, id, enabled),
      source,
    );
  }

  if (kind === 'color') {
    const device = applyImportedDeviceMeta(
      createRendererDeviceNode(kind, id, enabled) as ColorEffectNode,
      source,
    );
    device.params = {
      velocities: toIntegerArray(params.velocities),
      noteLengthPercent: toFiniteNumber(
        params.noteLengthPercent,
        device.params.noteLengthPercent,
      ),
      gapPercent: normalizeColorDeviceParams(params).gapPercent,
    };
    if (device.params.velocities.length === 0) {
      device.params.velocities = [...createRendererDeviceNode(kind, id, enabled).params.velocities];
    }
    return device;
  }

  const device = applyImportedDeviceMeta(
    createRendererDeviceNode(kind, id, enabled) as CurveModulatorNode,
    source,
  );
  device.params.amount = toFiniteNumber(params.amount, device.params.amount);
  device.params.target = sanitizeModulationTarget(params.target);
  device.params.curve = sanitizeModulationCurve(params.curve);
  return device;
};

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

  return createImportedDeviceNode(kind, value);
};

export interface HydratedGeneratorDevicesResult {
  devices: GeneratorDeviceNode[];
  invalidDeviceCount: number;
}

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
    rejectInvalidDevices?: boolean;
  } = {},
): HydratedGeneratorDevicesResult | null => {
  if (!Array.isArray(value)) {
    return null;
  }

  const devices: GeneratorDeviceNode[] = [];
  let invalidDeviceCount = 0;
  for (const device of value) {
    const hydrated = hydrateImportedGeneratorDevice(device);
    if (!hydrated) {
      invalidDeviceCount += 1;
      if (options.rejectInvalidDevices === true) {
        return null;
      }
      continue;
    }

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

export interface HydratedGeneratorChainResult {
  chain: GeneratorChain;
  invalidDeviceCount: number;
}

/** Validates and hydrates an externally loaded chain into a runtime-safe shape. */
export const hydrateImportedGeneratorChain = (
  value: unknown,
  options: {
    rejectInvalidDevices?: boolean;
  } = {},
): HydratedGeneratorChainResult | null => {
  if (!isRecord(value) || !Array.isArray(value.devices) || !isRecord(value.groupStateById)) {
    return null;
  }

  const hydratedDevices = hydrateImportedGeneratorDevices(value.devices, options);
  if (!hydratedDevices) {
    return null;
  }

  return {
    chain: sanitizeGeneratorChain({
      devices: hydratedDevices.devices,
      groupStateById: hydrateImportedGroupStateById(value.groupStateById),
    }),
    invalidDeviceCount: hydratedDevices.invalidDeviceCount,
  };
};
