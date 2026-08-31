import { getRendererDeviceGroup } from '../../../devices';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import type { GeneratorDeviceNode } from '../../../shared/model';

type RackDeviceItem = {
  kind: 'device';
  key: string;
  device: GeneratorDeviceNode;
};

type RackGroupItem = {
  kind: 'group';
  key: string;
  groupId: string;
  enabled: boolean;
  devices: GeneratorDeviceNode[];
};

type RackContentItem = RackDeviceItem | RackGroupItem;

type GroupColumn =
  | {
      kind: 'left-rail';
      key: `rail-left-${string}`;
      groupId: string;
      enabled: boolean;
    }
  | {
      kind: 'device';
      key: string;
      device: GeneratorDeviceNode;
    }
  | {
      kind: 'right-rail';
      key: `rail-right-${string}`;
      groupId: string;
    };

export const buildGroupMemberIdsByGroupId = (
  devices: readonly GeneratorDeviceNode[],
): Record<string, string[]> => {
  const byGroupId: Record<string, string[]> = {};
  for (const device of devices) {
    const groupId = normalizeOptionalId(device.groupId);
    if (!groupId) {
      continue;
    }

    const memberIds = byGroupId[groupId];
    if (memberIds) {
      memberIds.push(device.id);
      continue;
    }
    byGroupId[groupId] = [device.id];
  }
  return byGroupId;
};

export const buildOrderedGroupIds = (
  devices: readonly GeneratorDeviceNode[],
): string[] => {
  const groupIds: string[] = [];

  for (const device of devices) {
    const groupId = normalizeOptionalId(device.groupId);
    if (!groupId || groupIds.includes(groupId)) {
      continue;
    }

    groupIds.push(groupId);
  }

  return groupIds;
};

export const buildGeneratorDeviceIds = (
  devices: readonly GeneratorDeviceNode[],
): string[] => devices
  .filter((device) => getRendererDeviceGroup(device.kind) === 'generator')
  .map((device) => device.id);

export const buildRackContentItems = (
  devices: readonly GeneratorDeviceNode[],
  resolveGroupEnabled: (groupId: string) => boolean,
): RackContentItem[] => {
  const items: RackContentItem[] = [];
  let activeGroupId: string | null = null;
  let activeGroupDevices: GeneratorDeviceNode[] = [];

  const flushGroup = () => {
    if (!activeGroupId || activeGroupDevices.length === 0) {
      return;
    }

    const anchorId = activeGroupDevices.reduce(
      (min, device) => (device.id < min ? device.id : min),
      activeGroupDevices[0].id,
    );
    items.push({
      kind: 'group',
      key: `group-${activeGroupId}-${anchorId}`,
      groupId: activeGroupId,
      enabled: resolveGroupEnabled(activeGroupId),
      devices: activeGroupDevices,
    });
    activeGroupId = null;
    activeGroupDevices = [];
  };

  for (const device of devices) {
    const groupId = normalizeOptionalId(device.groupId);

    if (!groupId) {
      flushGroup();
      items.push({
        kind: 'device',
        key: `device-${device.id}`,
        device,
      });
      continue;
    }

    if (activeGroupId === groupId) {
      activeGroupDevices.push(device);
      continue;
    }

    flushGroup();
    activeGroupId = groupId;
    activeGroupDevices = [device];
  }

  flushGroup();
  return items;
};

export const buildGroupColumns = (groupItem: RackGroupItem): GroupColumn[] => {
  const columns: GroupColumn[] = groupItem.devices.map((device): GroupColumn => ({
    kind: 'device',
    key: device.id,
    device,
  }));

  const leftRail: GroupColumn = {
    kind: 'left-rail',
    key: `rail-left-${groupItem.groupId}`,
    groupId: groupItem.groupId,
    enabled: groupItem.enabled,
  };
  const rightRail: GroupColumn = {
    kind: 'right-rail',
    key: `rail-right-${groupItem.groupId}`,
    groupId: groupItem.groupId,
  };

  return [leftRail, ...columns, rightRail];
};
