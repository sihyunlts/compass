import { createMergeKeyResolver } from '../control-helpers';
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
    'set-mask-mode': (device, change) => {
      if (device.kind !== 'mask') {
        return false;
      }

      if (typeof change.value !== 'string') {
        return false;
      }

      device.params.mode = change.value === 'exclude' ? 'exclude' : 'include';
      return true;
    },
    'set-mask-source-visibility': (device, change) => {
      if (device.kind !== 'mask') {
        return false;
      }

      if (typeof change.value !== 'string') {
        return false;
      }

      device.params.sourceVisibility = change.value === 'show' ? 'show' : 'hide';
      return true;
    },
    'set-mask-source-kind': (device, change) => {
      if (device.kind !== 'mask') {
        return false;
      }

      if (typeof change.value !== 'string') {
        return false;
      }

      const nextKind = change.value === 'group'
        || change.value === 'generator'
        || change.value === 'tiles'
        ? change.value
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
    'set-mask-source-id': (device, change) => {
      if (device.kind !== 'mask') {
        return false;
      }

      if (typeof change.value !== 'string') {
        return false;
      }

      const rawId = change.value.trim();
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
