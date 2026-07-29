import type { RippleGeneratorNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
} from '../import-hydration';
import {
  boundedNumericParameter,
  defineNumericParameterRules,
  finiteNumericParameter,
  hydrateImportedNumericParameters,
} from '../numeric-parameters';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_RIPPLE_PARAMS: RippleGeneratorNode['params'] = {
  centerX: 4.5,
  centerY: 4.5,
  curvature: 2,
};

export const RIPPLE_NUMERIC_PARAMETERS = defineNumericParameterRules<
  RippleGeneratorNode['params']
>()({
  centerX: boundedNumericParameter({
    defaultValue: DEFAULT_RIPPLE_PARAMS.centerX,
    min: 0,
    max: 9,
    step: 0.5,
    modulationMessageKey: 'control.centerX',
  }),
  centerY: boundedNumericParameter({
    defaultValue: DEFAULT_RIPPLE_PARAMS.centerY,
    min: 0,
    max: 9,
    step: 0.5,
    modulationMessageKey: 'control.centerY',
  }),
  curvature: finiteNumericParameter({
    defaultValue: DEFAULT_RIPPLE_PARAMS.curvature,
    step: 0.1,
    modulationMessageKey: 'control.curvature',
  }),
});

const createDefaultRippleNode = (
  id: string,
  enabled: boolean,
): RippleGeneratorNode => ({
  id,
  kind: 'ripple',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_RIPPLE_PARAMS },
});

const hydrateImportedRippleNode = (
  source: Record<string, unknown>,
): RippleGeneratorNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultRippleNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  hydrateImportedNumericParameters(
    device.params,
    params,
    RIPPLE_NUMERIC_PARAMETERS,
  );
  return device;
};

export const rippleDeviceSchema = {
  kind: 'ripple',
  label: 'Ripple',
  group: 'generator',
  numericParameters: RIPPLE_NUMERIC_PARAMETERS,
  createDefaultNode: createDefaultRippleNode,
  hydrateImportedNode: hydrateImportedRippleNode,
} satisfies RendererDeviceSchema<'ripple'>;
