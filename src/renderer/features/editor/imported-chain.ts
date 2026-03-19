import {
  hydrateImportedGeneratorChain,
  type GeneratorChain,
} from '../../../shared/model';
import { syncDeviceNodeIdSeeds } from './device-node-factory';

/** Hydrates external chain payloads and advances local ID allocation past imported nodes. */
export const hydrateExternalGeneratorChain = (
  value: unknown,
): GeneratorChain | null => {
  const hydrated = hydrateImportedGeneratorChain(value);
  if (!hydrated) {
    return null;
  }

  syncDeviceNodeIdSeeds(hydrated.devices);
  return hydrated;
};
