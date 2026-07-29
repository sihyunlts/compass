import type { WaterdropGeneratorNode } from '../../shared/model';
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

const DEFAULT_WATERDROP_PARAMS: WaterdropGeneratorNode['params'] = {
  centerX: 4.5,
  centerY: 4.5,
  curvature: 2,
};

export const WATERDROP_NUMERIC_PARAMETERS = defineNumericParameterRules<
  WaterdropGeneratorNode['params']
>()({
  centerX: boundedNumericParameter({
    defaultValue: DEFAULT_WATERDROP_PARAMS.centerX,
    min: 0,
    max: 9,
    step: 0.5,
    modulationLabel: 'Center X',
  }),
  centerY: boundedNumericParameter({
    defaultValue: DEFAULT_WATERDROP_PARAMS.centerY,
    min: 0,
    max: 9,
    step: 0.5,
    modulationLabel: 'Center Y',
  }),
  curvature: finiteNumericParameter({
    defaultValue: DEFAULT_WATERDROP_PARAMS.curvature,
    step: 0.1,
    modulationLabel: 'Curvature',
  }),
});

const createDefaultWaterdropNode = (
  id: string,
  enabled: boolean,
): WaterdropGeneratorNode => ({
  id,
  kind: 'waterdrop',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_WATERDROP_PARAMS },
});

const hydrateImportedWaterdropNode = (
  source: Record<string, unknown>,
): WaterdropGeneratorNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultWaterdropNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  hydrateImportedNumericParameters(device.params, params, WATERDROP_NUMERIC_PARAMETERS);
  return device;
};

export const waterdropDeviceSchema = {
  kind: 'waterdrop',
  label: 'Waterdrop',
  group: 'generator',
  numericParameters: WATERDROP_NUMERIC_PARAMETERS,
  createDefaultNode: createDefaultWaterdropNode,
  hydrateImportedNode: hydrateImportedWaterdropNode,
} satisfies RendererDeviceSchema<'waterdrop'>;
