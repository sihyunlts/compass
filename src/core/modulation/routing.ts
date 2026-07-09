import {
  isCurveModulatorNode,
  type CurveModulatorNode,
  type GeneratorChain,
  type GeneratorDeviceNode,
  type ModulationTarget,
  type ModulationCurve,
} from '../../shared/model';
import { isModulationTargetDeviceKind, isModulationTargetParamKey } from '../../devices/modulation';
import { normalizeOptionalId } from '../../shared/normalize-id';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { sanitizeModulationCurve } from './curve';

export const DEFAULT_MODULATION_TARGET_AMOUNT = 1;
export const MODULATION_TARGET_SLOT_COUNT = 10;

const createIndexedTargetId = (index: number): string => `mod-target-${index + 1}`;

const resolveUniqueTargetId = (
  preferredId: string,
  fallbackIndex: number,
  seenIds: ReadonlySet<string>,
): string => {
  if (!seenIds.has(preferredId)) {
    return preferredId;
  }

  const fallbackId = createIndexedTargetId(fallbackIndex);
  if (!seenIds.has(fallbackId)) {
    return fallbackId;
  }

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${fallbackId}-${suffix}`;
    if (!seenIds.has(candidate)) {
      return candidate;
    }
  }
};

const sanitizeAmount = (
  value: unknown,
  fallback = 0,
): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Number(numeric.toFixed(6));
};

export const createModulationTargetId = (): string =>
  `mod-target-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(36)}`;

export const sanitizeModulationTargetAmount = (
  value: unknown,
): number => sanitizeAmount(value, DEFAULT_MODULATION_TARGET_AMOUNT);

export const isValidModulationTargetSlotIndex = (
  value: unknown,
): value is number => (
  typeof value === 'number'
  && Number.isInteger(value)
  && value >= 0
  && value < MODULATION_TARGET_SLOT_COUNT
);

const sanitizeModulationTargetSlotIndex = (
  value: unknown,
  fallback: number,
): number => {
  if (isValidModulationTargetSlotIndex(value)) {
    return value;
  }

  if (isValidModulationTargetSlotIndex(fallback)) {
    return fallback;
  }

  return 0;
};

const resolveAvailableSlotIndex = (
  preferredSlotIndex: number,
  seenSlotIndices: ReadonlySet<number>,
): number | null => {
  for (let slotIndex = preferredSlotIndex; slotIndex < MODULATION_TARGET_SLOT_COUNT; slotIndex += 1) {
    if (!seenSlotIndices.has(slotIndex)) {
      return slotIndex;
    }
  }

  for (let slotIndex = 0; slotIndex < preferredSlotIndex; slotIndex += 1) {
    if (!seenSlotIndices.has(slotIndex)) {
      return slotIndex;
    }
  }

  return null;
};

export const sanitizeModulationTarget = (
  target: unknown,
  fallbackId = '',
  fallbackSlotIndex = 0,
): ModulationTarget | null => {
  if (!target || typeof target !== 'object') {
    return null;
  }

  const id = typeof (target as { id?: unknown }).id === 'string'
    ? (target as { id: string }).id.trim()
    : fallbackId;
  const deviceId = typeof (target as { deviceId?: unknown }).deviceId === 'string'
    ? (target as { deviceId: string }).deviceId.trim()
    : '';
  const paramKey = typeof (target as { paramKey?: unknown }).paramKey === 'string'
    ? (target as { paramKey: string }).paramKey.trim()
    : '';

  if (!deviceId || !paramKey) {
    return null;
  }

  return {
    id: id || fallbackId || createModulationTargetId(),
    slotIndex: sanitizeModulationTargetSlotIndex(
      (target as { slotIndex?: unknown }).slotIndex,
      fallbackSlotIndex,
    ),
    deviceId,
    paramKey,
    amount: sanitizeModulationTargetAmount((target as { amount?: unknown }).amount),
  };
};

export const sanitizeModulationTargets = (
  targets: unknown,
): ModulationTarget[] => {
  if (!Array.isArray(targets)) {
    return [];
  }

  const sanitizedTargets: ModulationTarget[] = [];
  const seenIds = new Set<string>();
  const seenSlotIndices = new Set<number>();
  for (let index = 0; index < targets.length; index += 1) {
    const target = sanitizeModulationTarget(
      targets[index],
      createIndexedTargetId(index),
      index,
    );
    if (!target) {
      continue;
    }

    const targetId = resolveUniqueTargetId(target.id, index, seenIds);
    seenIds.add(targetId);

    const slotIndex = resolveAvailableSlotIndex(target.slotIndex, seenSlotIndices);
    if (slotIndex === null) {
      continue;
    }
    seenSlotIndices.add(slotIndex);

    sanitizedTargets.push({
      ...target,
      id: targetId,
      slotIndex,
    });
  }

  return sanitizedTargets.sort((left, right) => left.slotIndex - right.slotIndex);
};

const sanitizeCurveModulatorNode = (
  node: CurveModulatorNode,
): CurveModulatorNode => ({
  id: node.id,
  kind: 'modulator',
  enabled: node.enabled,
  groupId: node.groupId ?? null,
  name: node.name ?? null,
  params: {
    targets: sanitizeModulationTargets(node.params.targets),
    curve: sanitizeModulationCurve(node.params.curve),
  },
});

const resolveValidModulationTargetDevice = (
  chain: GeneratorChain,
  target: ModulationTarget | null,
): GeneratorDeviceNode | null => {
  if (!target) {
    return null;
  }

  const targetDeviceIndex = chain.devices.findIndex((device) => device.id === target.deviceId);
  if (targetDeviceIndex === -1) {
    return null;
  }

  const targetDevice = chain.devices[targetDeviceIndex];
  if (!targetDevice || !isModulationTargetDeviceKind(targetDevice.kind)) {
    return null;
  }

  return isModulationTargetParamKey(targetDevice.kind, target.paramKey)
    ? targetDevice
    : null;
};

export const reconcileGeneratorChainModulators = (
  chain: GeneratorChain,
): boolean => {
  let changed = false;
  const seenTargetKeys = new Set<string>();

  for (let deviceIndex = 0; deviceIndex < chain.devices.length; deviceIndex += 1) {
    const device = chain.devices[deviceIndex];
    if (!isCurveModulatorNode(device)) {
      continue;
    }

    const sanitized = sanitizeCurveModulatorNode(device);
    if (sanitized.enabled !== device.enabled) {
      device.enabled = sanitized.enabled;
      changed = true;
    }

    const originalCurve = device.params.curve;
    const nextCurve: ModulationCurve = sanitized.params.curve;
    if (
      originalCurve.domain !== nextCurve.domain
      || originalCurve.divisions !== nextCurve.divisions
      || JSON.stringify(originalCurve.nodes) !== JSON.stringify(nextCurve.nodes)
    ) {
      device.params.curve = nextCurve;
      changed = true;
    }

    const nextTargets: ModulationTarget[] = [];
    for (const target of sanitized.params.targets) {
      const targetKey = `${target.deviceId}:${target.paramKey}`;
      if (!resolveValidModulationTargetDevice(chain, target) || seenTargetKeys.has(targetKey)) {
        continue;
      }
      seenTargetKeys.add(targetKey);
      nextTargets.push(target);
    }

    if (JSON.stringify(device.params.targets) !== JSON.stringify(nextTargets)) {
      device.params.targets = nextTargets;
      changed = true;
    }
  }

  return changed;
};

interface ValidatedModulationRoute {
  modulator: CurveModulatorNode;
  target: ModulationTarget;
  targetDevice: GeneratorDeviceNode;
  targetParamKey: string;
}

export const collectValidatedModulationRoutes = (
  chain: GeneratorChain,
): ValidatedModulationRoute[] => {
  const routes: ValidatedModulationRoute[] = [];
  const seenTargetKeys = new Set<string>();

  for (let deviceIndex = 0; deviceIndex < chain.devices.length; deviceIndex += 1) {
    const device = chain.devices[deviceIndex];
    if (!isCurveModulatorNode(device) || !isDeviceEffectivelyEnabled(chain, device)) {
      continue;
    }

    const sanitized = sanitizeCurveModulatorNode(device);
    for (const target of sanitized.params.targets) {
      const targetKey = `${target.deviceId}:${target.paramKey}`;
      if (seenTargetKeys.has(targetKey)) {
        continue;
      }

      const targetDevice = resolveValidModulationTargetDevice(chain, target);
      if (!targetDevice) {
        continue;
      }

      seenTargetKeys.add(targetKey);
      routes.push({
        modulator: sanitized,
        target,
        targetDevice,
        targetParamKey: target.paramKey,
      });
    }
  }

  return routes;
};

export const stripModulationDevicesFromChain = (
  chain: GeneratorChain,
): GeneratorChain => {
  const devices = chain.devices.filter((device) => device.kind !== 'modulator');
  const activeGroupIds = new Set<string>();
  for (const device of devices) {
    const groupId = normalizeOptionalId(device.groupId);
    if (groupId) {
      activeGroupIds.add(groupId);
    }
  }

  const groupStateById: GeneratorChain['groupStateById'] = {};
  for (const groupId of activeGroupIds) {
    groupStateById[groupId] = {
      enabled: chain.groupStateById[groupId]?.enabled !== false,
      name: chain.groupStateById[groupId]?.name ?? null,
    };
  }

  return {
    devices,
    groupStateById,
  };
};
