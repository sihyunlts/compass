import type {
  CurveNode,
  GeneratorDeviceNode,
  ModulationCurve,
  PathAnchor,
  TimeWarpCurve,
} from './chain';
import { cloneAuthoredMetadata } from './authored-metadata';

export const clonePathAnchors = (anchors: readonly PathAnchor[]): PathAnchor[] =>
  anchors.map((anchor) => ({
    id: anchor.id,
    x: anchor.x,
    y: anchor.y,
    ...(anchor.handleIn ? { handleIn: { ...anchor.handleIn } } : {}),
    ...(anchor.handleOut ? { handleOut: { ...anchor.handleOut } } : {}),
  }));

const cloneCurveNodes = (nodes: readonly CurveNode[]): CurveNode[] =>
  nodes.map((node) => ({
    id: node.id,
    t: node.t,
    v: node.v,
    ...(typeof node.nextCurveBend === 'number'
      ? {
        nextCurveBend: node.nextCurveBend,
      }
      : {}),
  }));

const cloneModulationCurve = (curve: ModulationCurve): ModulationCurve => ({
  domain: curve.domain,
  divisions: curve.divisions,
  nodes: cloneCurveNodes(curve.nodes),
});

const cloneTimeWarpCurve = (curve: TimeWarpCurve): TimeWarpCurve => ({
  divisions: curve.divisions,
  nodes: cloneCurveNodes(curve.nodes),
});

const cloneDeviceNodePayload = (
  device: GeneratorDeviceNode,
): GeneratorDeviceNode => {
  if (device.kind === 'ripple') {
    return {
      id: device.id,
      kind: 'ripple',
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

  if (device.kind === 'rain') {
    return {
      id: device.id,
      kind: 'rain',
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
        fill: device.params.fill === true,
        transform: { ...device.params.transform },
        animation: { ...device.params.animation },
        anchors: clonePathAnchors(device.params.anchors),
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

  if (device.kind === 'timewarp') {
    return {
      id: device.id,
      kind: 'timewarp',
      enabled: device.enabled,
      groupId: device.groupId ?? null,
      name: device.name ?? null,
      params: {
        curve: cloneTimeWarpCurve(device.params.curve),
      },
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
        targets: device.params.targets.map((target) => ({
          id: target.id,
          slotIndex: target.slotIndex,
          deviceId: target.deviceId,
          paramKey: target.paramKey,
          amount: target.amount,
        })),
        curve: cloneModulationCurve(device.params.curve),
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

  return {
    id: device.id,
    kind: 'scale',
    enabled: device.enabled,
    groupId: device.groupId ?? null,
    name: device.name ?? null,
    params: { ...device.params },
  };
};

export function cloneDeviceNode<TDevice extends GeneratorDeviceNode>(device: TDevice): TDevice;
export function cloneDeviceNode(device: GeneratorDeviceNode): GeneratorDeviceNode;
export function cloneDeviceNode(
  device: GeneratorDeviceNode,
): GeneratorDeviceNode {
  const cloned = cloneDeviceNodePayload(device);
  const metadata = cloneAuthoredMetadata(device.metadata);
  return metadata ? { ...cloned, metadata } : cloned;
}
