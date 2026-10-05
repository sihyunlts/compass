import {
  getRendererDeviceLabel,
  type RendererDeviceKind,
} from '../../../devices';
import {
  DEFAULT_GROUP_NAME_TEMPLATE,
  applyNameIndex,
  hasNameIndexToken,
  normalizeCustomName,
  type GeneratorChain,
  type GeneratorDeviceNode,
} from '../../../shared/model';
import { buildOrderedGroupIds } from './layout';

export const resolveStoredGroupName = (
  groupStateById: GeneratorChain['groupStateById'],
  groupId: string,
): string | null => normalizeCustomName(groupStateById[groupId]?.name);

export interface DeviceNameSnapshot {
  readonly kind: RendererDeviceKind;
  readonly customName: string | null;
  readonly index: number;
}

export const resolveDeviceNameSnapshot = (
  snapshot: DeviceNameSnapshot,
  resolveDefaultName: (kind: RendererDeviceKind) => string = getRendererDeviceLabel,
): string => snapshot.customName ?? `${resolveDefaultName(snapshot.kind)} ${snapshot.index}`;

const createNameSnapshotResolver = () => {
  const nextIndexByTemplate = new Map<string, number>();
  return (customName: string | null, defaultTemplate: string) => {
    const template = customName ?? defaultTemplate;
    const indexed = hasNameIndexToken(template);
    const index = indexed ? (nextIndexByTemplate.get(template) ?? 0) + 1 : 0;
    if (indexed) nextIndexByTemplate.set(template, index);
    return { customName: customName === null ? null : applyNameIndex(customName, index), index };
  };
};

export const buildDeviceNameSnapshotsById = (
  devices: readonly GeneratorDeviceNode[],
  resolveDefaultName: (kind: RendererDeviceKind) => string = getRendererDeviceLabel,
): Record<string, DeviceNameSnapshot> => {
  const resolveName = createNameSnapshotResolver();
  return Object.fromEntries(devices.map((device) => [device.id, {
    kind: device.kind,
    ...resolveName(normalizeCustomName(device.name), `${resolveDefaultName(device.kind)} #`),
  }]));
};

export const buildDeviceDisplayNameById = (
  devices: readonly GeneratorDeviceNode[],
  resolveDefaultName: (kind: RendererDeviceKind) => string = getRendererDeviceLabel,
): Record<string, string> => Object.fromEntries(
  Object.entries(buildDeviceNameSnapshotsById(devices, resolveDefaultName))
    .map(([id, snapshot]) => [id, resolveDeviceNameSnapshot(snapshot, resolveDefaultName)]),
);

export const buildGroupDisplayNameById = (
  devices: readonly GeneratorDeviceNode[],
  groupStateById: GeneratorChain['groupStateById'],
  defaultNameTemplate: string = DEFAULT_GROUP_NAME_TEMPLATE,
): Record<string, string> => Object.fromEntries(
  Object.entries(buildGroupNameSnapshotsById({ devices, groupStateById }, defaultNameTemplate))
    .map(([id, snapshot]) => [id, snapshot.customName ?? applyNameIndex(defaultNameTemplate, snapshot.index)]),
);

export interface GroupNameSnapshot {
  readonly kind: 'group';
  readonly customName: string | null;
  readonly index: number;
}

export const buildGroupNameSnapshotsById = (
  chain: { devices: readonly GeneratorDeviceNode[]; groupStateById: GeneratorChain['groupStateById'] },
  defaultTemplate: string,
): Record<string, GroupNameSnapshot> => {
  const resolveName = createNameSnapshotResolver();
  return Object.fromEntries(buildOrderedGroupIds(chain.devices).map((id) => [id, {
    kind: 'group',
    ...resolveName(resolveStoredGroupName(chain.groupStateById, id), defaultTemplate),
  }]));
};
