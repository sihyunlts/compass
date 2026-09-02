import type { RotateEffectNode } from '../../shared/model';
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

const DEFAULT_ROTATE_PARAMS: RotateEffectNode['params'] = {
  centerX: 4.5,
  centerY: 4.5,
  angleDeg: 0,
};

export const ROTATE_NUMERIC_PARAMETERS = defineNumericParameterRules<
  RotateEffectNode['params']
>()({
  centerX: boundedNumericParameter({
    defaultValue: DEFAULT_ROTATE_PARAMS.centerX,
    min: 0,
    max: 9,
    step: 0.5,
    dragPixelsPerStep: DISCRETE_DRAG_PIXELS_PER_STEP,
    modulationMessageKey: 'control.centerX',
  }),
  centerY: boundedNumericParameter({
    defaultValue: DEFAULT_ROTATE_PARAMS.centerY,
    min: 0,
    max: 9,
    step: 0.5,
    dragPixelsPerStep: DISCRETE_DRAG_PIXELS_PER_STEP,
    modulationMessageKey: 'control.centerY',
  }),
  angleDeg: finiteNumericParameter({
    defaultValue: DEFAULT_ROTATE_PARAMS.angleDeg,
    step: 1,
    display: {
      unit: '°',
      format: 'rotation',
    },
    modulationMessageKey: 'control.angle',
  }),
});

const createDefaultRotateNode = (
  id: string,
  enabled: boolean,
): RotateEffectNode => ({
  id,
  kind: 'rotate',
  enabled,
  groupId: null,
  params: { ...DEFAULT_ROTATE_PARAMS },
});

const hydrateImportedRotateNode = (
  source: Record<string, unknown>,
): RotateEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultRotateNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  hydrateImportedNumericParameters(device.params, params, ROTATE_NUMERIC_PARAMETERS);
  return device;
};

export const rotateDeviceSchema = {
  kind: 'rotate',
  label: 'Rotate',
  group: 'effect',
  numericParameters: ROTATE_NUMERIC_PARAMETERS,
  createDefaultNode: createDefaultRotateNode,
  hydrateImportedNode: hydrateImportedRotateNode,
} satisfies RendererDeviceSchema<'rotate'>;
