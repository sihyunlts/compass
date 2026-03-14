import type { GeneratorChain } from './chain';
import { cloneDeviceNode } from './device-clone';

/** Clones a chain into an IPC-safe payload with normalized group enabled flags. */
export const cloneChainForIpc = (chain: GeneratorChain): GeneratorChain => {
  const groupStateById: GeneratorChain['groupStateById'] = {};
  for (const [groupId, state] of Object.entries(chain.groupStateById)) {
    groupStateById[groupId] = {
      enabled: state.enabled,
      name: state.name ?? null,
    };
  }

  return {
    devices: chain.devices.map((device) => cloneDeviceNode(device)),
    groupStateById,
  };
};
