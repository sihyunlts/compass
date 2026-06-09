import type { GeneratorChain, GeneratorDeviceNode } from '../../shared/model';
import { isDeviceEffectivelyEnabled } from '../../shared/group-state';
import { normalizeOptionalId } from '../../shared/normalize-id';

const resolveEffectMutedSource = (
  device: GeneratorDeviceNode,
): { kind: 'group' | 'generator'; sourceId: string } | null => {
  if (device.kind !== 'mask' || device.params.sourceVisibility === 'show') {
    return null;
  }

  const sourceKind = device.params.sourceKind;
  if (sourceKind !== 'group' && sourceKind !== 'generator') {
    return null;
  }

  const sourceId = normalizeOptionalId(device.params.sourceId);
  return sourceId ? { kind: sourceKind, sourceId } : null;
};

export const resolveMutedSources = (
  chain: GeneratorChain,
): {
  mutedGroupIds: Set<string>;
  mutedGeneratorIds: Set<string>;
} => {
  const mutedGroupIds = new Set<string>();
  const mutedGeneratorIds = new Set<string>();

  for (const device of chain.devices) {
    if (!isDeviceEffectivelyEnabled(chain, device)) {
      continue;
    }

    const mutedSource = resolveEffectMutedSource(device);
    if (!mutedSource) {
      continue;
    }

    if (mutedSource.kind === 'group') {
      mutedGroupIds.add(mutedSource.sourceId);
    } else {
      mutedGeneratorIds.add(mutedSource.sourceId);
    }
  }

  return { mutedGroupIds, mutedGeneratorIds };
};
