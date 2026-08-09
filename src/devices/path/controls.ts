import {
  createMergeKeyResolver,
  parseStructuredControlValue,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { isImportRecord } from '../import-hydration';
import {
  IDENTITY_PATH_TRANSFORM,
  sanitizePathAnchors,
  sanitizePathTransform,
} from './schema';

export const pathDeviceControls = {
  descriptors: {
    'set-path-geometry': {
      resolveMergeKey: createMergeKeyResolver('set-path-geometry'),
    },
    'set-path-fill': {
      resolveMergeKey: createMergeKeyResolver('set-path-fill'),
    },
    'set-path-animation-enabled': {
      resolveMergeKey: createMergeKeyResolver('set-path-animation-enabled'),
    },
    'set-path-animation-direction': {
      resolveMergeKey: createMergeKeyResolver('set-path-animation-direction'),
    },
    'set-path-animation-start-anchor': {
      resolveMergeKey: createMergeKeyResolver('set-path-animation-start-anchor'),
    },
  },
  createHandlers: () => ({
    'set-path-geometry': (device, change) => {
      if (device.kind !== 'path') {
        return false;
      }
      const parsed = parseStructuredControlValue(change.value);
      if (!parsed.ok || !isImportRecord(parsed.value)) {
        return false;
      }
      const previousStartAnchorId = device.params.animation.startAnchorId;
      device.params.anchors = sanitizePathAnchors(parsed.value.anchors);
      device.params.closed = parsed.value.closed === true && device.params.anchors.length >= 2;
      device.params.transform = device.params.anchors.length > 0
        ? sanitizePathTransform(parsed.value.transform)
        : { ...IDENTITY_PATH_TRANSFORM };
      const anchorIdReplacement = isImportRecord(parsed.value.anchorIdReplacement)
        ? parsed.value.anchorIdReplacement
        : null;
      if (
        anchorIdReplacement?.from === previousStartAnchorId
        && typeof anchorIdReplacement.to === 'string'
        && device.params.anchors.some((anchor) => anchor.id === anchorIdReplacement.to)
      ) {
        device.params.animation.startAnchorId = anchorIdReplacement.to;
      }
      if (!device.params.anchors.some(
        (anchor) => anchor.id === device.params.animation.startAnchorId,
      )) {
        device.params.animation.startAnchorId = device.params.anchors[0]?.id ?? '';
      }
      if (!device.params.closed || device.params.anchors.length < 3) {
        device.params.fill = false;
      }
      return true;
    },
    'set-path-fill': (device, change) => {
      if (device.kind !== 'path') {
        return false;
      }
      const fill = change.value === true && device.params.anchors.length >= 3;
      device.params.fill = fill;
      if (fill) {
        device.params.closed = true;
      }
      return true;
    },
    'set-path-animation-enabled': (device, change) => {
      if (device.kind !== 'path') {
        return false;
      }
      device.params.animation.enabled = change.value === true;
      return true;
    },
    'set-path-animation-direction': (device, change) => {
      if (device.kind !== 'path') {
        return false;
      }
      device.params.animation.direction = change.value === 'reverse'
        ? 'reverse'
        : 'forward';
      return true;
    },
    'set-path-animation-start-anchor': (device, change) => {
      if (
        device.kind !== 'path'
        || !device.params.closed
        || typeof change.value !== 'string'
        || !device.params.anchors.some((anchor) => anchor.id === change.value)
      ) {
        return false;
      }
      device.params.animation.startAnchorId = change.value;
      return true;
    },
  }),
} satisfies RendererKindControlDefinition;
