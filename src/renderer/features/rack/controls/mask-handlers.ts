import type { ChainControlContext, ChainControlDescriptor, ChainControlHandler } from './shared';
import { createMergeKeyResolver, requireSelect } from './shared';

const handleSetMaskMode = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'mask') {
    return false;
  }

  const select = requireSelect(target);
  if (!select) {
    return false;
  }

  device.params.mode = select.value === 'exclude' ? 'exclude' : 'include';
  return true;
};

const handleSetMaskSourceVisibility = (): ChainControlHandler => (device, target) => {
  if (device.kind !== 'mask') {
    return false;
  }

  const select = requireSelect(target);
  if (!select) {
    return false;
  }

  device.params.sourceVisibility = select.value === 'show' ? 'show' : 'hide';
  return true;
};

const handleSetMaskSourceKind = (context: ChainControlContext): ChainControlHandler => (device, target) => {
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
};

const handleSetMaskSourceId = (context: ChainControlContext): ChainControlHandler => (device, target) => {
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
};

export const MASK_CONTROL_DESCRIPTORS: Record<string, ChainControlDescriptor> = {
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
};

export const createMaskControlHandlers = (
  context: ChainControlContext,
): Record<string, ChainControlHandler> => ({
  'set-mask-mode': handleSetMaskMode(),
  'set-mask-source-visibility': handleSetMaskSourceVisibility(),
  'set-mask-source-kind': handleSetMaskSourceKind(context),
  'set-mask-source-id': handleSetMaskSourceId(context),
});
