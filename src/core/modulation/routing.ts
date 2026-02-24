import { clamp } from '../../shared/math';
import type {
  CurveModulatorNode,
  GeneratorChain,
  GeneratorDeviceNode,
  ModulationTarget,
  ModulationCurve,
} from '../../shared/types';
import { isModulationTargetDeviceKind, isModulationTargetParamKey } from '../../shared/device-registry';
import { normalizeOptionalId } from '../../shared/normalize-id';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { sanitizeModulationCurve } from './curve';

const MIN_MODULATION_AMOUNT = -128;
const MAX_MODULATION_AMOUNT = 128;

const isCurveModulatorNode = (
  device: GeneratorDeviceNode,
): device is CurveModulatorNode => device.kind === 'modulator';

const sanitizeAmount = (value: unknown): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Number(clamp(numeric, MIN_MODULATION_AMOUNT, MAX_MODULATION_AMOUNT).toFixed(6));
};

export const sanitizeModulationTarget = (
  target: unknown,
): ModulationTarget | null => {
  if (!target || typeof target !== 'object') {
    return null;
  }

  const deviceId = typeof (target as { deviceId?: unknown }).deviceId === 'string'
    ? (target as { deviceId: string }).deviceId.trim()
    : '';
  const paramKey = typeof (target as { paramKey?: unknown }).paramKey === 'string'
    ? (target as { paramKey: string }).paramKey.trim()
    : '';

  if (!deviceId || !paramKey) {
    return null;
  }

  return { deviceId, paramKey };
};

const sanitizeCurveModulatorNode = (
  node: CurveModulatorNode,
): CurveModulatorNode => ({
  id: node.id,
  kind: 'modulator',
  enabled: node.enabled !== false,
  params: {
    amount: sanitizeAmount(node.params.amount),
    target: sanitizeModulationTarget(node.params.target),
    curve: sanitizeModulationCurve(node.params.curve),
  },
});

const hasValidTarget = (
  chain: GeneratorChain,
  target: ModulationTarget | null,
): boolean => {
  if (!target) {
    return false;
  }

  const targetDevice = chain.devices.find((device) => device.id === target.deviceId);
  if (!targetDevice || !isModulationTargetDeviceKind(targetDevice.kind)) {
    return false;
  }

  return isModulationTargetParamKey(targetDevice.kind, target.paramKey);
};

export const reconcileGeneratorChainModulators = (
  chain: GeneratorChain,
): boolean => {
  let changed = false;
  const seenTargetKeys = new Set<string>();

  for (const device of chain.devices) {
    if (!isCurveModulatorNode(device)) {
      continue;
    }

    const sanitized = sanitizeCurveModulatorNode(device);
    if (sanitized.enabled !== device.enabled) {
      device.enabled = sanitized.enabled;
      changed = true;
    }
    if (sanitized.params.amount !== device.params.amount) {
      device.params.amount = sanitized.params.amount;
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

    const target = sanitized.params.target;
    const targetKey = target ? `${target.deviceId}:${target.paramKey}` : '';
    const isTargetValid = hasValidTarget(chain, target);
    const isTargetDuplicated = targetKey ? seenTargetKeys.has(targetKey) : false;
    const nextTarget = isTargetValid && !isTargetDuplicated ? target : null;

    const prevTarget = device.params.target;
    const isSameTarget = (
      (prevTarget?.deviceId ?? '') === (nextTarget?.deviceId ?? '')
      && (prevTarget?.paramKey ?? '') === (nextTarget?.paramKey ?? '')
    );
    if (!isSameTarget) {
      device.params.target = nextTarget;
      changed = true;
    }

    if (nextTarget) {
      seenTargetKeys.add(`${nextTarget.deviceId}:${nextTarget.paramKey}`);
    }
  }

  return changed;
};

export interface ValidatedModulationRoute {
  modulator: CurveModulatorNode;
  targetDevice: GeneratorDeviceNode;
  targetParamKey: string;
}

export const collectValidatedModulationRoutes = (
  chain: GeneratorChain,
): ValidatedModulationRoute[] => {
  const routes: ValidatedModulationRoute[] = [];
  const seenTargetKeys = new Set<string>();

  for (const device of chain.devices) {
    if (!isCurveModulatorNode(device) || !isDeviceEffectivelyEnabled(chain, device)) {
      continue;
    }

    const target = sanitizeModulationTarget(device.params.target);
    if (!target) {
      continue;
    }

    const targetKey = `${target.deviceId}:${target.paramKey}`;
    if (seenTargetKeys.has(targetKey)) {
      continue;
    }

    const targetDevice = chain.devices.find((item) => item.id === target.deviceId);
    if (!targetDevice || !isModulationTargetDeviceKind(targetDevice.kind)) {
      continue;
    }

    if (!isModulationTargetParamKey(targetDevice.kind, target.paramKey)) {
      continue;
    }

    seenTargetKeys.add(targetKey);
    routes.push({
      modulator: sanitizeCurveModulatorNode(device),
      targetDevice,
      targetParamKey: target.paramKey,
    });
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
    };
  }

  return {
    devices,
    groupStateById,
  };
};
