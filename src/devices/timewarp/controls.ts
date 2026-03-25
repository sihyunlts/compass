import {
  createMergeKeyResolver,
  requireInput,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { sanitizeTimeWarpCurveNodes } from '../../core/timewarp/curve';

export const timeWarpDeviceControls = {
  descriptors: {
    'set-timewarp-curve-nodes': {
      resolveMergeKey: createMergeKeyResolver('set-timewarp-curve-nodes'),
    },
  },
  createHandlers: () => ({
    'set-timewarp-curve-nodes': (device, target) => {
      if (device.kind !== 'timewarp') {
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

      device.params.curve.nodes = sanitizeTimeWarpCurveNodes(parsed);
      return true;
    },
  }),
} satisfies RendererKindControlDefinition;
