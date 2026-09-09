import { normalizeOptionalId } from './normalize-id';
import type {
  GeneratorChain,
  GeneratorDeviceNode,
  GroupMode,
} from './model';

export const DEFAULT_GROUP_MODE: GroupMode = 'normal';

export const isIsolatedGroupMode = (value: unknown): value is 'isolate' =>
  value === 'isolate';

export const normalizeGroupMode = (value: unknown): GroupMode =>
  isIsolatedGroupMode(value) ? 'isolate' : DEFAULT_GROUP_MODE;

export const resolveGroupMode = (
  groupStateById: GeneratorChain['groupStateById'],
  groupId: string | null | undefined,
): GroupMode => {
  const normalizedGroupId = normalizeOptionalId(groupId);
  return normalizeGroupMode(
    normalizedGroupId ? groupStateById[normalizedGroupId]?.mode : undefined,
  );
};

export const isGroupIsolated = (
  chain: Pick<GeneratorChain, 'groupStateById'>,
  groupId: string | null | undefined,
): boolean => resolveGroupMode(chain.groupStateById, groupId) === 'isolate';

export const collectActiveIsolatedGroupIds = (
  chain: Pick<GeneratorChain, 'devices' | 'groupStateById'>,
): Set<string> => {
  const groupIds = new Set<string>();
  for (const device of chain.devices) {
    const groupId = normalizeOptionalId(device.groupId);
    if (groupId && isGroupIsolated(chain, groupId)) {
      groupIds.add(groupId);
    }
  }
  return groupIds;
};

export const resolveEffectTargetGroupId = (
  chain: GeneratorChain,
  memberGroupId: string | null | undefined,
): string | null => {
  const normalizedGroupId = normalizeOptionalId(memberGroupId);
  if (!normalizedGroupId) {
    return null;
  }

  return isGroupIsolated(chain, normalizedGroupId)
    ? normalizedGroupId
    : null;
};

const isGroupEnabled = (
  chain: GeneratorChain,
  groupId: string | null | undefined,
): boolean => {
  const normalizedGroupId = normalizeOptionalId(groupId);
  if (!normalizedGroupId) {
    return true;
  }

  return chain.groupStateById[normalizedGroupId]?.enabled !== false;
};

export const isDeviceEffectivelyEnabled = (
  chain: GeneratorChain,
  device: GeneratorDeviceNode,
): boolean => (
  device.enabled
  && isGroupEnabled(chain, device.groupId)
);
