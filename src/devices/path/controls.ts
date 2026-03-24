import {
  createMergeKeyResolver,
  requireInput,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { sanitizePathPoints } from './schema';

export const pathDeviceControls = {
  descriptors: {
    'set-path-points': {
      resolveMergeKey: createMergeKeyResolver('set-path-points'),
    },
  },
  createHandlers: () => ({
    'set-path-points': (device, target) => {
      if (device.kind !== 'path') {
        return false;
      }

      const input = requireInput(target);
      if (!input) {
        return false;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(input.value);
      } catch {
        return false;
      }

      device.params.points = sanitizePathPoints(parsed);
      device.params.closed = false;
      return true;
    },
  }),
} satisfies RendererKindControlDefinition;
