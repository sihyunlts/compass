import type { StretchEffectNode } from '../../shared/model';
import { isNonWrapping01TemporalWindow } from '../../core/scene-operators/temporal';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
  toFiniteNumber,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_STRETCH_PARAMS: StretchEffectNode['params'] = {
  start: 0,
  end: 1,
};

const STRETCH_MODULATION_TARGET_PARAMS = [
  { key: 'start', label: 'Start' },
  { key: 'end', label: 'End' },
] as const;
export const STRETCH_NUMERIC_PARAM_KEYS = ['start', 'end'] as const;

const createDefaultStretchNode = (
  id: string,
  enabled: boolean,
): StretchEffectNode => ({
  id,
  kind: 'stretch',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_STRETCH_PARAMS },
});

const hydrateImportedStretchNode = (
  source: Record<string, unknown>,
): StretchEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultStretchNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  const start = toFiniteNumber(params.start, device.params.start);
  const end = toFiniteNumber(params.end, device.params.end);
  if (isNonWrapping01TemporalWindow(start, end)) {
    device.params.start = start;
    device.params.end = end;
  }
  return device;
};

export const stretchDeviceSchema = {
  kind: 'stretch',
  label: 'Stretch',
  group: 'effect',
  modulationTargetParams: STRETCH_MODULATION_TARGET_PARAMS,
  numericParamKeys: STRETCH_NUMERIC_PARAM_KEYS,
  createDefaultNode: createDefaultStretchNode,
  hydrateImportedNode: hydrateImportedStretchNode,
} satisfies RendererDeviceSchema<'stretch'>;
