import {
  normalizeAuthoredMetadata,
  replaceAuthoredMetadata,
  type AuthoredMetadata,
  type GeneratorChain,
} from '../../../shared/model';
import { normalizeCustomName } from '../../../shared/model/naming';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import { reconcileGroupStateById, withDevices } from './chain-ops';

export interface AuthoredInfoDraft {
  name: string;
  author: string;
  description: string;
}

const isMetadataEqual = (
  left: AuthoredMetadata | undefined,
  right: AuthoredMetadata | undefined,
): boolean => left?.author === right?.author
  && left?.description === right?.description;

export const updateDeviceAuthoredInfo = (
  chain: GeneratorChain,
  deviceId: string,
  draft: AuthoredInfoDraft,
): GeneratorChain | null => {
  const nextName = normalizeCustomName(draft.name);
  const nextMetadata = normalizeAuthoredMetadata(draft);
  let didChange = false;
  const nextDevices = chain.devices.map((device) => {
    if (device.id !== deviceId) {
      return device;
    }
    if (
      normalizeCustomName(device.name) === nextName
      && isMetadataEqual(device.metadata, nextMetadata)
    ) {
      return device;
    }

    didChange = true;
    return replaceAuthoredMetadata({
      ...device,
      name: nextName,
    }, nextMetadata) as typeof device;
  });

  return didChange ? withDevices(chain, nextDevices) : null;
};

export const updateGroupAuthoredInfo = (
  chain: GeneratorChain,
  rawGroupId: string,
  draft: AuthoredInfoDraft,
): GeneratorChain | null => {
  const groupId = normalizeOptionalId(rawGroupId);
  if (
    !groupId
    || !chain.devices.some(
      (device) => normalizeOptionalId(device.groupId) === groupId,
    )
  ) {
    return null;
  }

  const groupStateById = reconcileGroupStateById(
    chain.groupStateById,
    chain.devices,
  );
  const current = groupStateById[groupId];
  const nextName = normalizeCustomName(draft.name);
  const nextMetadata = normalizeAuthoredMetadata(draft);
  if (
    normalizeCustomName(current?.name) === nextName
    && isMetadataEqual(current?.metadata, nextMetadata)
  ) {
    return null;
  }

  return {
    ...chain,
    groupStateById: {
      ...groupStateById,
      [groupId]: {
        enabled: current?.enabled !== false,
        name: nextName,
        ...(nextMetadata ? { metadata: nextMetadata } : {}),
      },
    },
  };
};

export const updateRackAuthoredMetadata = (
  chain: GeneratorChain,
  draft: Pick<AuthoredInfoDraft, 'author' | 'description'>,
): GeneratorChain | null => {
  const nextMetadata = normalizeAuthoredMetadata(draft);
  if (isMetadataEqual(chain.metadata, nextMetadata)) {
    return null;
  }

  return replaceAuthoredMetadata(chain, nextMetadata);
};
