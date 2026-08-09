import {
  createMergeKeyResolver,
  parseStructuredControlValue,
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
    'set-timewarp-curve-nodes': (device, change) => {
      if (device.kind !== 'timewarp') {
        return false;
      }

      const parsed = parseStructuredControlValue(change.value);
      if (!parsed.ok) {
        return false;
      }

      device.params.curve.nodes = sanitizeTimeWarpCurveNodes(parsed.value);
      return true;
    },
  }),
} satisfies RendererKindControlDefinition;
