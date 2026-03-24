import { isNonWrapping01TemporalWindow } from '../../core/scene-operators/temporal';
import type { TrimEffectNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_TRIM_PARAMS: TrimEffectNode['params'] = {
  start: 0,
  end: 1,
};

const TRIM_MODULATION_TARGET_PARAMS = [
  { key: 'start', label: 'Start' },
  { key: 'end', label: 'End' },
] as const;
export const TRIM_NUMERIC_PARAM_KEYS = ['start', 'end'] as const;

const createDefaultTrimNode = (
  id: string,
  enabled: boolean,
): TrimEffectNode => ({
  id,
  kind: 'trim',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_TRIM_PARAMS },
});

const hydrateImportedTrimNode = (
  source: Record<string, unknown>,
): TrimEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultTrimNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  const start = Number(params.start);
  const end = Number(params.end);
  if (isNonWrapping01TemporalWindow(start, end)) {
    device.params.start = start;
    device.params.end = end;
  }
  return device;
};

export const trimDeviceSchema = {
  kind: 'trim',
  label: 'Trim',
  group: 'effect',
  modulationTargetParams: TRIM_MODULATION_TARGET_PARAMS,
  numericParamKeys: TRIM_NUMERIC_PARAM_KEYS,
  createDefaultNode: createDefaultTrimNode,
  hydrateImportedNode: hydrateImportedTrimNode,
} satisfies RendererDeviceSchema<'trim'>;
