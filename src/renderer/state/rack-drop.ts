import { normalizeOptionalId } from '../../shared/normalize-id';
import type { GeneratorDeviceNode } from '../../shared/types';

export type DropPlacement = 'before' | 'after';

export type RackDropZone =
  | {
      kind: 'inside-group';
      groupId: string;
      targetId: string;
      placement: DropPlacement;
    }
  | {
      kind: 'outside';
      targetId: string | null;
      placement: DropPlacement;
    };

export type ChainDragSourceKind = 'devices' | 'group';

const resolveInsertIndex = (
  devices: readonly GeneratorDeviceNode[],
  targetId: string | null,
  placement: DropPlacement,
): number => {
  if (!targetId) {
    return devices.length;
  }

  const targetIndex = devices.findIndex((device) => device.id === targetId);
  if (targetIndex < 0) {
    return devices.length;
  }

  return placement === 'after' ? targetIndex + 1 : targetIndex;
};

const areSameByIdAndGroup = (
  left: readonly GeneratorDeviceNode[],
  right: readonly GeneratorDeviceNode[],
): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index].id !== right[index].id) {
      return false;
    }

    const leftGroupId = normalizeOptionalId(left[index].groupId);
    const rightGroupId = normalizeOptionalId(right[index].groupId);
    if (leftGroupId !== rightGroupId) {
      return false;
    }
  }

  return true;
};

export const applyMoveDevicesByDropZone = (
  devices: readonly GeneratorDeviceNode[],
  sourceIds: readonly string[],
  drop: RackDropZone,
  sourceKind: ChainDragSourceKind,
): GeneratorDeviceNode[] | null => {
  const sourceSet = new Set(sourceIds);
  if (sourceSet.size === 0) {
    return null;
  }

  const moved: GeneratorDeviceNode[] = [];
  const remaining: GeneratorDeviceNode[] = [];

  for (const device of devices) {
    if (sourceSet.has(device.id)) {
      moved.push(device);
    } else {
      remaining.push(device);
    }
  }

  if (moved.length === 0) {
    return null;
  }

  const nextGroupId = drop.kind === 'inside-group' ? normalizeOptionalId(drop.groupId) : null;
  const movedWithGroup =
    sourceKind === 'group'
      ? moved
      : moved.map((device) => {
          const currentGroupId = normalizeOptionalId(device.groupId);
          if (currentGroupId === nextGroupId) {
            return device;
          }
          return {
            ...device,
            groupId: nextGroupId,
          };
        });

  const insertIndex = resolveInsertIndex(remaining, drop.targetId, drop.placement);
  const nextDevices = [...remaining];
  nextDevices.splice(insertIndex, 0, ...movedWithGroup);

  return areSameByIdAndGroup(devices, nextDevices) ? null : nextDevices;
};

export const coerceOutsideTargetIdToGroupBoundaryByDevices = (
  devices: readonly GeneratorDeviceNode[],
  targetId: string | null,
  placement: DropPlacement,
): string | null => {
  if (!targetId) {
    return null;
  }

  const targetIndex = devices.findIndex((device) => device.id === targetId);
  if (targetIndex < 0) {
    return targetId;
  }

  const targetGroupId = normalizeOptionalId(devices[targetIndex].groupId);
  if (!targetGroupId) {
    return targetId;
  }

  const groupDevices = devices.filter(
    (device) => normalizeOptionalId(device.groupId) === targetGroupId,
  );
  if (groupDevices.length === 0) {
    return targetId;
  }

  return placement === 'before'
    ? groupDevices[0].id
    : groupDevices[groupDevices.length - 1].id;
};

export const applyInsertDevicesByDropZone = (
  devices: readonly GeneratorDeviceNode[],
  toInsert: readonly GeneratorDeviceNode[],
  dropZone: RackDropZone,
  forcedGroupId?: string | null,
): GeneratorDeviceNode[] => {
  if (toInsert.length === 0) {
    return [...devices];
  }

  const insertIndex = resolveInsertIndex(devices, dropZone.targetId, dropZone.placement);
  const defaultGroupId = dropZone.kind === 'inside-group'
    ? normalizeOptionalId(dropZone.groupId)
    : null;
  const nextGroupId = forcedGroupId === undefined
    ? defaultGroupId
    : normalizeOptionalId(forcedGroupId);

  const nextDevices = [...devices];
  nextDevices.splice(
    insertIndex,
    0,
    ...toInsert.map((device) => ({
      ...device,
      groupId: nextGroupId,
    })),
  );
  return nextDevices;
};

export const applyInsertDeviceByDropZone = (
  devices: readonly GeneratorDeviceNode[],
  device: GeneratorDeviceNode,
  drop: RackDropZone,
): GeneratorDeviceNode[] =>
  applyInsertDevicesByDropZone(devices, [device], drop);
