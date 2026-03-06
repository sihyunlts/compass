import {
  createMergeKeyResolver,
  requireSelect,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';

export const symmetryDeviceControls = {
  descriptors: {
    'set-effect-symmetry-mode': {
      resolveMergeKey: createMergeKeyResolver('set-effect-symmetry-mode'),
    },
    'set-effect-symmetry-axis': {
      resolveMergeKey: createMergeKeyResolver('set-effect-symmetry-axis'),
    },
    'set-effect-symmetry-anchor': {
      resolveMergeKey: createMergeKeyResolver('set-effect-symmetry-anchor'),
    },
  },
  createHandlers: () => ({
    'set-effect-symmetry-mode': (device, target) => {
      if (device.kind !== 'symmetry') {
        return false;
      }

      const select = requireSelect(target);
      if (!select) {
        return false;
      }

      const mode = select.value;
      device.params.mode = mode === 'quad-mirror'
        || mode === 'quad-pinwheel'
        || mode === 'mirror-half'
        ? mode
        : 'mirror-half';
      return true;
    },
    'set-effect-symmetry-axis': (device, target) => {
      if (device.kind !== 'symmetry') {
        return false;
      }

      const select = requireSelect(target);
      if (!select) {
        return false;
      }

      device.params.axis = select.value === 'vertical' ? 'vertical' : 'horizontal';
      return true;
    },
    'set-effect-symmetry-anchor': (device, target) => {
      if (device.kind !== 'symmetry') {
        return false;
      }

      const select = requireSelect(target);
      if (!select) {
        return false;
      }

      const anchor = select.value;
      device.params.sourceAnchor = anchor === 'br' || anchor === 'tr' || anchor === 'tl'
        ? anchor
        : 'bl';
      return true;
    },
  }),
} satisfies RendererKindControlDefinition;
