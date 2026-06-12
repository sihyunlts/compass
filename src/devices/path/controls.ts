import { createMergeKeyResolver } from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { sanitizePathPoints } from './schema';

export const pathDeviceControls = {
  descriptors: {
    'set-path-points': {
      resolveMergeKey: createMergeKeyResolver('set-path-points'),
    },
  },
  createHandlers: () => ({
    'set-path-points': (device, change) => {
      if (device.kind !== 'path') {
        return false;
      }

      let parsed: unknown;
      if (typeof change.value === 'string') {
        try {
          parsed = JSON.parse(change.value);
        } catch {
          return false;
        }
      } else {
        parsed = change.value;
      }

      device.params.points = sanitizePathPoints(parsed);
      device.params.closed = false;
      return true;
    },
  }),
} satisfies RendererKindControlDefinition;
