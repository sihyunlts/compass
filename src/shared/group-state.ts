import { normalizeOptionalId } from './normalize-id';
import type {
  GeneratorChain,
  GeneratorDeviceNode,
} from './model';

const isGroupEnabled = (
  chain: GeneratorChain,
  groupId: string | null | undefined,
): boolean => {
  const normalizedGroupId = normalizeOptionalId(groupId);
  if (!normalizedGroupId) {
    return true;
  }

  return (chain.groupStateById ?? {})[normalizedGroupId]?.enabled !== false;
};

export const isDeviceEffectivelyEnabled = (
  chain: GeneratorChain,
  device: GeneratorDeviceNode,
): boolean => (
  device.enabled === true
  && isGroupEnabled(chain, device.groupId)
);
