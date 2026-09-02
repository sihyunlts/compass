import type { RepeatEffectNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
} from '../import-hydration';
import {
  boundedIntegerParameter,
  boundedNumericParameter,
  DISCRETE_DRAG_PIXELS_PER_STEP,
  defineNumericParameterRules,
  hydrateImportedNumericParameters,
} from '../numeric-parameters';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_REPEAT_PARAMS: RepeatEffectNode['params'] = {
  count: 2,
  intervalPercent: 100,
};

export const REPEAT_NUMERIC_PARAMETERS = defineNumericParameterRules<
  RepeatEffectNode['params']
>()({
  count: boundedIntegerParameter({
    defaultValue: DEFAULT_REPEAT_PARAMS.count,
    min: 1,
    max: 32,
    step: 1,
    dragPixelsPerStep: DISCRETE_DRAG_PIXELS_PER_STEP,
  }),
  intervalPercent: boundedNumericParameter({
    defaultValue: DEFAULT_REPEAT_PARAMS.intervalPercent,
    min: 25,
    max: 400,
    step: 1,
    display: { unit: '%' },
  }),
});

const createDefaultRepeatNode = (
  id: string,
  enabled: boolean,
): RepeatEffectNode => ({
  id,
  kind: 'repeat',
  enabled,
  groupId: null,
  params: { ...DEFAULT_REPEAT_PARAMS },
});

const hydrateImportedRepeatNode = (
  source: Record<string, unknown>,
): RepeatEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultRepeatNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  hydrateImportedNumericParameters(
    device.params,
    resolveImportedParams(source),
    REPEAT_NUMERIC_PARAMETERS,
  );
  return device;
};

export const repeatDeviceSchema = {
  kind: 'repeat',
  label: 'Repeat',
  group: 'effect',
  numericParameters: REPEAT_NUMERIC_PARAMETERS,
  createDefaultNode: createDefaultRepeatNode,
  hydrateImportedNode: hydrateImportedRepeatNode,
} satisfies RendererDeviceSchema<'repeat'>;
