import type { TimeWarpEffectNode } from '../../shared/model';
import { sanitizeTimeWarpCurve } from '../../core/timewarp/curve';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_TIME_WARP_PARAMS: TimeWarpEffectNode['params'] = {
  curve: sanitizeTimeWarpCurve(null),
};

const createDefaultTimeWarpNode = (
  id: string,
  enabled: boolean,
): TimeWarpEffectNode => ({
  id,
  kind: 'timewarp',
  enabled: enabled !== false,
  groupId: null,
  params: {
    curve: sanitizeTimeWarpCurve(DEFAULT_TIME_WARP_PARAMS.curve),
  },
});

const hydrateImportedTimeWarpNode = (
  source: Record<string, unknown>,
): TimeWarpEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultTimeWarpNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  device.params.curve = sanitizeTimeWarpCurve(params.curve);
  return device;
};

export const timeWarpDeviceSchema = {
  kind: 'timewarp',
  label: 'Time Warp',
  group: 'effect',
  createDefaultNode: createDefaultTimeWarpNode,
  hydrateImportedNode: hydrateImportedTimeWarpNode,
} satisfies RendererDeviceSchema<'timewarp'>;
