import type { StretchEffectNode } from '../../shared/model';
import { isNonWrapping01TemporalWindow } from '../../core/scene-operators/temporal';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
} from '../import-hydration';
import { createTimeWindowNumericParameters } from '../time-window-parameters';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_STRETCH_PARAMS: StretchEffectNode['params'] = {
  start: 0,
  end: 1,
};

export const STRETCH_NUMERIC_PARAMETERS = createTimeWindowNumericParameters(
  DEFAULT_STRETCH_PARAMS,
);

const createDefaultStretchNode = (
  id: string,
  enabled: boolean,
): StretchEffectNode => ({
  id,
  kind: 'stretch',
  enabled,
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
  const start = Number(params.start);
  const end = Number(params.end);
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
  numericParameters: STRETCH_NUMERIC_PARAMETERS,
  createDefaultNode: createDefaultStretchNode,
  hydrateImportedNode: hydrateImportedStretchNode,
} satisfies RendererDeviceSchema<'stretch'>;
