import type { ScannerGeneratorNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
} from '../import-hydration';
import {
  cyclicNumericParameter,
  defineNumericParameterRules,
  hydrateImportedNumericParameters,
} from '../numeric-parameters';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_SCANNER_PARAMS: ScannerGeneratorNode['params'] = {
  angleDeg: 0,
};

export const SCANNER_NUMERIC_PARAMETERS = defineNumericParameterRules<
  ScannerGeneratorNode['params']
>()({
  angleDeg: cyclicNumericParameter({
    defaultValue: DEFAULT_SCANNER_PARAMS.angleDeg,
    min: 0,
    period: 360,
    step: 1,
    display: { unit: '°' },
    modulationLabel: 'Sweep Direction',
  }),
});

const createDefaultScannerNode = (
  id: string,
  enabled: boolean,
): ScannerGeneratorNode => ({
  id,
  kind: 'scanner',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_SCANNER_PARAMS },
});

const hydrateImportedScannerNode = (
  source: Record<string, unknown>,
): ScannerGeneratorNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultScannerNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  hydrateImportedNumericParameters(device.params, params, SCANNER_NUMERIC_PARAMETERS);
  return device;
};

export const scannerDeviceSchema = {
  kind: 'scanner',
  label: 'Scanner',
  group: 'generator',
  numericParameters: SCANNER_NUMERIC_PARAMETERS,
  createDefaultNode: createDefaultScannerNode,
  hydrateImportedNode: hydrateImportedScannerNode,
} satisfies RendererDeviceSchema<'scanner'>;
