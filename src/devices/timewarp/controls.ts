import { createMergeKeyResolver } from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { sanitizeTimeWarpCurveNodes } from '../../core/timewarp/curve';

export const timeWarpDeviceControls = {
  descriptors: {
    'set-timewarp-curve-nodes': {
      resolveMergeKey: createMergeKeyResolver('set-timewarp-curve-nodes'),
    },
  },
  createHandlers: () => ({
    'set-timewarp-curve-nodes': (device, change) => {
      if (device.kind !== 'timewarp') {
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

      device.params.curve.nodes = sanitizeTimeWarpCurveNodes(parsed);
      return true;
    },
  }),
} satisfies RendererKindControlDefinition;
