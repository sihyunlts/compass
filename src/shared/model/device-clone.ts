import type { GeneratorDeviceNode, ModulationCurve } from './chain';

const cloneCurve = (curve: ModulationCurve): ModulationCurve => ({
  domain: curve.domain,
  divisions: curve.divisions,
  nodes: curve.nodes.map((node) => ({ ...node })),
});

export const cloneDeviceNode = (
  device: GeneratorDeviceNode,
): GeneratorDeviceNode => {
  if (device.kind === 'waterdrop') {
    return {
      id: device.id,
      kind: 'waterdrop',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'scanner') {
    return {
      id: device.id,
      kind: 'scanner',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'spiral') {
    return {
      id: device.id,
      kind: 'spiral',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'reverse') {
    return {
      id: device.id,
      kind: 'reverse',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
    };
  }

  if (device.kind === 'modulator') {
    return {
      id: device.id,
      kind: 'modulator',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: {
        amount: device.params.amount,
        target: device.params.target
          ? {
            deviceId: device.params.target.deviceId,
            paramKey: device.params.target.paramKey,
          }
          : null,
        curve: cloneCurve(device.params.curve),
      },
    };
  }

  if (device.kind === 'mask') {
    return {
      id: device.id,
      kind: 'mask',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: {
        mode: device.params.mode,
        tiles: [...device.params.tiles],
        sourceKind: device.params.sourceKind ?? 'tiles',
        sourceId: device.params.sourceId ?? null,
        sourceVisibility: device.params.sourceVisibility === 'show' ? 'show' : 'hide',
      },
    };
  }

  if (device.kind === 'color') {
    return {
      id: device.id,
      kind: 'color',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: {
        velocities: [...device.params.velocities],
        noteLengthPercent: device.params.noteLengthPercent,
      },
    };
  }

  if (device.kind === 'mirror') {
    return {
      id: device.id,
      kind: 'mirror',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'symmetry') {
    return {
      id: device.id,
      kind: 'symmetry',
      enabled: device.enabled !== false,
      groupId: device.groupId ?? null,
      params: { ...device.params },
    };
  }

  return {
    id: device.id,
    kind: 'rotate',
    enabled: device.enabled !== false,
    groupId: device.groupId ?? null,
    params: { ...device.params },
  };
};
