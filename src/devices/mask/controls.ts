import {
  createMergeKeyResolver,
  requireSelect,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';

export const maskDeviceControls = {
  descriptors: {
    'set-mask-mode': {
      resolveMergeKey: createMergeKeyResolver('set-mask-mode'),
    },
    'set-mask-source-visibility': {
      resolveMergeKey: createMergeKeyResolver('set-mask-source-visibility'),
    },
    'set-mask-source-kind': {
      resolveMergeKey: createMergeKeyResolver('set-mask-source-kind'),
    },
    'set-mask-source-id': {
      resolveMergeKey: createMergeKeyResolver('set-mask-source-id'),
    },
  },
  createHandlers: (context) => ({
    'set-mask-mode': (device, target) => {
      if (device.kind !== 'mask') {
        return false;
      }

      const select = requireSelect(target);
      if (!select) {
        return false;
      }

      device.params.mode = select.value === 'exclude' ? 'exclude' : 'include';
      return true;
    },
    'set-mask-source-visibility': (device, target) => {
      if (device.kind !== 'mask') {
        return false;
      }

      const select = requireSelect(target);
      if (!select) {
        return false;
      }

      device.params.sourceVisibility = select.value === 'show' ? 'show' : 'hide';
      return true;
    },
    'set-mask-source-kind': (device, target) => {
      if (device.kind !== 'mask') {
        return false;
      }

      const select = requireSelect(target);
      if (!select) {
        return false;
      }

      const nextKind = select.value === 'group'
        || select.value === 'generator'
        || select.value === 'tiles'
        ? select.value
        : 'tiles';
      device.params.sourceKind = nextKind;

      if (nextKind === 'tiles') {
        device.params.sourceId = null;
        return true;
      }

      const options = nextKind === 'group'
        ? context.getMaskSourceGroupIds()
        : context.getMaskSourceGeneratorIds();
      if (!options.includes(device.params.sourceId ?? '')) {
        device.params.sourceId = options[0] ?? null;
      }
      return true;
    },
    'set-mask-source-id': (device, target) => {
      if (device.kind !== 'mask') {
        return false;
      }

      const select = requireSelect(target);
      if (!select) {
        return false;
      }

      const rawId = select.value.trim();
      if (!rawId) {
        device.params.sourceId = null;
        return true;
      }

      if (device.params.sourceKind === 'group') {
        device.params.sourceId = context.getMaskSourceGroupIds().includes(rawId)
          ? rawId
          : null;
        return true;
      }

      if (device.params.sourceKind === 'generator') {
        device.params.sourceId = context.getMaskSourceGeneratorIds().includes(rawId)
          ? rawId
          : null;
        return true;
      }

      device.params.sourceId = null;
      return true;
    },
  }),
} satisfies RendererKindControlDefinition;
