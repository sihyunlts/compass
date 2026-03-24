import type { GeneratorDeviceNode, ModulationCurve } from './chain';

const cloneCurve = (curve: ModulationCurve): ModulationCurve => ({
  domain: curve.domain,
  divisions: curve.divisions,
  nodes: curve.nodes.map((node) => ({
    id: node.id,
    t: node.t,
    v: node.v,
    ...(typeof node.nextCurveBend === 'number'
      ? {
        nextCurveBend: node.nextCurveBend,
      }
      : {}),
  })),
});

const assertUnsupportedDeviceKind = (device: never): never => {
  const kind = (device as { kind?: unknown }).kind;
  throw new Error(`Unsupported device kind: ${String(kind ?? 'unknown')}`);
};

export const cloneDeviceNode = (
  device: GeneratorDeviceNode,
): GeneratorDeviceNode => {
  if (device.kind === 'waterdrop') {
    return {
      id: device.id,
      kind: 'waterdrop',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'scanner') {
    return {
      id: device.id,
      kind: 'scanner',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'spiral') {
    return {
      id: device.id,
      kind: 'spiral',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'path') {
    return {
      id: device.id,
      kind: 'path',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: {
        closed: device.params.closed === true,
        points: device.params.points.map((point) => ({
          x: point.x,
          y: point.y,
        })),
      },
    };
  }

  if (device.kind === 'reverse') {
    return {
      id: device.id,
      kind: 'reverse',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
    };
  }

  if (device.kind === 'stretch') {
    return {
      id: device.id,
      kind: 'stretch',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'trim') {
    return {
      id: device.id,
      kind: 'trim',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'modulator') {
    return {
      id: device.id,
      kind: 'modulator',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
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
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: {
        mode: device.params.mode,
        tiles: [...device.params.tiles],
        sourceKind: device.params.sourceKind,
        sourceDomain: device.params.sourceDomain,
        sourceId: device.params.sourceId ?? null,
        sourceVisibility: device.params.sourceVisibility,
      },
    };
  }

  if (device.kind === 'color') {
    return {
      id: device.id,
      kind: 'color',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: {
        velocities: [...device.params.velocities],
        noteLengthPercent: device.params.noteLengthPercent,
        gapPercent: device.params.gapPercent,
      },
    };
  }

  if (device.kind === 'mirror') {
    return {
      id: device.id,
      kind: 'mirror',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'symmetry') {
    return {
      id: device.id,
      kind: 'symmetry',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'rotate') {
    return {
      id: device.id,
      kind: 'rotate',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'translate') {
    return {
      id: device.id,
      kind: 'translate',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: { ...device.params },
    };
  }

  if (device.kind === 'scale') {
    return {
      id: device.id,
      kind: 'scale',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: { ...device.params },
    };
  }

  return assertUnsupportedDeviceKind(device);
};
