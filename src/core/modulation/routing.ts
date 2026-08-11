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
import { sanitizeModulationTargets } from './targets';

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
    const seenTargetKeys = new Set<string>();
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

  for (let deviceIndex = 0; deviceIndex < chain.devices.length; deviceIndex += 1) {
    const device = chain.devices[deviceIndex];
    if (!isCurveModulatorNode(device) || !isDeviceEffectivelyEnabled(chain, device)) {
      continue;
    }

    const sanitized = sanitizeCurveModulatorNode(device);
    const seenTargetKeys = new Set<string>();
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
      ...(chain.groupStateById[groupId]?.metadata
        ? { metadata: chain.groupStateById[groupId].metadata }
        : {}),
    };
  }

  return {
    name: chain.name ?? null,
    ...(chain.metadata ? { metadata: chain.metadata } : {}),
    devices,
    groupStateById,
  };
};
