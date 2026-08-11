import type { GeneratorChain } from './chain';
import { cloneAuthoredMetadata } from './authored-metadata';
import { cloneDeviceNode } from './device-clone';

/** Clones a chain into an IPC-safe payload with normalized group enabled flags. */
export const cloneChainForIpc = (chain: GeneratorChain): GeneratorChain => {
  const groupStateById: GeneratorChain['groupStateById'] = {};
  for (const [groupId, state] of Object.entries(chain.groupStateById)) {
    const metadata = cloneAuthoredMetadata(state.metadata);
    groupStateById[groupId] = {
      enabled: state.enabled,
      name: state.name ?? null,
      ...(metadata ? { metadata } : {}),
    };
  }

  const metadata = cloneAuthoredMetadata(chain.metadata);
  return {
    name: chain.name ?? null,
    ...(metadata ? { metadata } : {}),
    devices: chain.devices.map((device) => cloneDeviceNode(device)),
    groupStateById,
  };
};
