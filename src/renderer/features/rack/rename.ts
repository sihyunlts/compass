import type { GeneratorChain, GeneratorDeviceNode } from '../../../shared/model';
import {
  DEFAULT_GROUP_NAME_TEMPLATE,
  normalizeCustomName,
} from '../../../shared/model/naming';
import { resolveStoredGroupName } from './display-names';

export type RackRenameTarget = {
  kind: 'device' | 'group';
  id: string;
};

export const resolveRenamePopoverTarget = (
  renameTarget: RackRenameTarget | null,
  collapsedSet: ReadonlySet<string>,
): RackRenameTarget | null => {
  if (!renameTarget) {
    return null;
  }

  if (renameTarget.kind === 'group') {
    return renameTarget;
  }

  return collapsedSet.has(renameTarget.id) ? renameTarget : null;
};

export const isRenamingDevice = (
  renameTarget: RackRenameTarget | null,
  deviceId: string,
): boolean => renameTarget?.kind === 'device' && renameTarget.id === deviceId;

export const isRenamingGroup = (
  renameTarget: RackRenameTarget | null,
  groupId: string,
): boolean => renameTarget?.kind === 'group' && renameTarget.id === groupId;

export const resolveDeviceDisplayName = (
  deviceDisplayNameById: Record<string, string>,
  deviceId: string,
): string => deviceDisplayNameById[deviceId] ?? '';

export const resolveGroupDisplayName = (
  groupDisplayNameById: Record<string, string>,
  groupId: string,
): string => groupDisplayNameById[groupId] ?? groupId;

export const resolveDeviceRenameValue = (
  renameTarget: RackRenameTarget | null,
  renameDraft: string,
  deviceId: string,
): string => isRenamingDevice(renameTarget, deviceId) ? renameDraft : '';

export const resolveEditableDeviceName = (
  device: GeneratorDeviceNode,
  deviceDisplayNameById: Record<string, string>,
): string => normalizeCustomName(device.name) ?? resolveDeviceDisplayName(deviceDisplayNameById, device.id);

export const resolveEditableGroupName = (
  groupId: string,
  groupStateById: GeneratorChain['groupStateById'],
  defaultNameTemplate: string = DEFAULT_GROUP_NAME_TEMPLATE,
): string => resolveStoredGroupName(groupStateById, groupId)
  ?? defaultNameTemplate;

type ResolveCommittedRenameDraftOptions = {
  renameTarget: RackRenameTarget | null;
  renameDraft: string;
  devices: readonly GeneratorDeviceNode[];
  resolveDefaultDeviceName: (kind: GeneratorDeviceNode['kind']) => string;
  defaultGroupNameTemplate?: string;
};

export const resolveCommittedRenameDraft = ({
  renameTarget,
  renameDraft,
  devices,
  resolveDefaultDeviceName,
  defaultGroupNameTemplate = DEFAULT_GROUP_NAME_TEMPLATE,
}: ResolveCommittedRenameDraftOptions): string => {
  if (!renameTarget) {
    return renameDraft;
  }

  const nextName = normalizeCustomName(renameDraft);
  if (renameTarget.kind === 'device') {
    const device = devices.find((item: GeneratorDeviceNode) => item.id === renameTarget.id);
    if (!device) {
      return renameDraft;
    }

    if (nextName === normalizeCustomName(resolveDefaultDeviceName(device.kind))) {
      return '';
    }

    return renameDraft;
  }

  if (nextName === normalizeCustomName(defaultGroupNameTemplate)) {
    return '';
  }

  return renameDraft;
};
