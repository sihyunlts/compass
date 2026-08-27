import type { ScaleEffectNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
} from '../import-hydration';
import {
  boundedNumericParameter,
  DISCRETE_DRAG_PIXELS_PER_STEP,
  defineNumericParameterRules,
  finiteNumericParameter,
  hydrateImportedNumericParameters,
} from '../numeric-parameters';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_SCALE_PARAMS: ScaleEffectNode['params'] = {
  centerX: 4.5,
  centerY: 4.5,
  scaleX: 1,
  scaleY: 1,
};

export const SCALE_NUMERIC_PARAMETERS = defineNumericParameterRules<
  ScaleEffectNode['params']
>()({
  centerX: boundedNumericParameter({
    defaultValue: DEFAULT_SCALE_PARAMS.centerX,
    min: 0,
    max: 9,
    step: 0.5,
    dragPixelsPerStep: DISCRETE_DRAG_PIXELS_PER_STEP,
    modulationMessageKey: 'control.centerX',
  }),
  centerY: boundedNumericParameter({
    defaultValue: DEFAULT_SCALE_PARAMS.centerY,
    min: 0,
    max: 9,
    step: 0.5,
    dragPixelsPerStep: DISCRETE_DRAG_PIXELS_PER_STEP,
    modulationMessageKey: 'control.centerY',
  }),
  scaleX: finiteNumericParameter({
    defaultValue: DEFAULT_SCALE_PARAMS.scaleX,
    step: 0.1,
    display: { unit: '×' },
    modulationMessageKey: 'control.scaleX',
  }),
  scaleY: finiteNumericParameter({
    defaultValue: DEFAULT_SCALE_PARAMS.scaleY,
    step: 0.1,
    display: { unit: '×' },
    modulationMessageKey: 'control.scaleY',
  }),
});

const createDefaultScaleNode = (
  id: string,
  enabled: boolean,
): ScaleEffectNode => ({
  id,
  kind: 'scale',
  enabled,
  groupId: null,
  params: { ...DEFAULT_SCALE_PARAMS },
});

const hydrateImportedScaleNode = (
  source: Record<string, unknown>,
): ScaleEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultScaleNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  hydrateImportedNumericParameters(device.params, params, SCALE_NUMERIC_PARAMETERS);
  return device;
};

export const scaleDeviceSchema = {
  kind: 'scale',
  label: 'Scale',
  group: 'effect',
  numericParameters: SCALE_NUMERIC_PARAMETERS,
  createDefaultNode: createDefaultScaleNode,
  hydrateImportedNode: hydrateImportedScaleNode,
} satisfies RendererDeviceSchema<'scale'>;
