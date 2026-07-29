import type { RainGeneratorNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
} from '../import-hydration';
import {
  boundedIntegerParameter,
  boundedNumericParameter,
  cyclicNumericParameter,
  defineNumericParameterRules,
  hydrateImportedNumericParameters,
} from '../numeric-parameters';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_RAIN_PARAMS: RainGeneratorNode['params'] = {
  seed: 1,
  angleDeg: 270,
  density: 4,
  speed: 1,
};

export const RAIN_NUMERIC_PARAMETERS = defineNumericParameterRules<
  RainGeneratorNode['params']
>()({
  seed: boundedIntegerParameter({
    defaultValue: DEFAULT_RAIN_PARAMS.seed,
    min: 0,
    max: 9999,
    step: 1,
  }),
  angleDeg: cyclicNumericParameter({
    defaultValue: DEFAULT_RAIN_PARAMS.angleDeg,
    min: 0,
    period: 360,
    step: 1,
    display: { unit: '°' },
    modulationLabel: 'Direction',
  }),
  density: boundedNumericParameter({
    defaultValue: DEFAULT_RAIN_PARAMS.density,
    min: 0,
    max: 32,
    step: 1,
    modulationLabel: 'Density',
  }),
  speed: boundedNumericParameter({
    defaultValue: DEFAULT_RAIN_PARAMS.speed,
    min: 0.3,
    max: 6,
    step: 0.1,
    display: { unit: '×' },
    modulationLabel: 'Speed',
  }),
});

const createDefaultRainNode = (
  id: string,
  enabled: boolean,
): RainGeneratorNode => ({
  id,
  kind: 'rain',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_RAIN_PARAMS },
});

const hydrateImportedRainNode = (
  source: Record<string, unknown>,
): RainGeneratorNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultRainNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  hydrateImportedNumericParameters(device.params, params, RAIN_NUMERIC_PARAMETERS);
  return device;
};

export const rainDeviceSchema = {
  kind: 'rain',
  label: 'Rain',
  group: 'generator',
  numericParameters: RAIN_NUMERIC_PARAMETERS,
  createDefaultNode: createDefaultRainNode,
  hydrateImportedNode: hydrateImportedRainNode,
} satisfies RendererDeviceSchema<'rain'>;
