import type { SpiralGeneratorNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
} from '../import-hydration';
import {
  boundedNumericParameter,
  defineNumericParameterRules,
  hydrateImportedNumericParameters,
} from '../numeric-parameters';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_SPIRAL_PARAMS: SpiralGeneratorNode['params'] = {
  centerX: 4.5,
  centerY: 4.5,
  turns: 2,
};

export const SPIRAL_NUMERIC_PARAMETERS = defineNumericParameterRules<
  SpiralGeneratorNode['params']
>()({
  centerX: boundedNumericParameter({
    defaultValue: DEFAULT_SPIRAL_PARAMS.centerX,
    min: 0,
    max: 9,
    step: 0.5,
    modulationMessageKey: 'control.centerX',
  }),
  centerY: boundedNumericParameter({
    defaultValue: DEFAULT_SPIRAL_PARAMS.centerY,
    min: 0,
    max: 9,
    step: 0.5,
    modulationMessageKey: 'control.centerY',
  }),
  turns: boundedNumericParameter({
    defaultValue: DEFAULT_SPIRAL_PARAMS.turns,
    min: 0.25,
    max: 8,
    step: 0.1,
    modulationMessageKey: 'control.turns',
  }),
});

const createDefaultSpiralNode = (
  id: string,
  enabled: boolean,
): SpiralGeneratorNode => ({
  id,
  kind: 'spiral',
  enabled,
  groupId: null,
  params: { ...DEFAULT_SPIRAL_PARAMS },
});

const hydrateImportedSpiralNode = (
  source: Record<string, unknown>,
): SpiralGeneratorNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultSpiralNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  hydrateImportedNumericParameters(device.params, params, SPIRAL_NUMERIC_PARAMETERS);
  return device;
};

export const spiralDeviceSchema = {
  kind: 'spiral',
  label: 'Spiral',
  group: 'generator',
  numericParameters: SPIRAL_NUMERIC_PARAMETERS,
  createDefaultNode: createDefaultSpiralNode,
  hydrateImportedNode: hydrateImportedSpiralNode,
} satisfies RendererDeviceSchema<'spiral'>;
