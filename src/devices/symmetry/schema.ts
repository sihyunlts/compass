import {
  MAX_SYMMETRY_RESULT_COUNT,
  MIN_SYMMETRY_RESULT_COUNT,
  resolveSymmetryResultCount,
} from '../../core/symmetry';
import type { SymmetryEffectNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
} from '../import-hydration';
import {
  boundedNumericParameter,
  customNumericParameter,
  cyclicNumericParameter,
  defineNumericParameterRules,
} from '../numeric-parameters';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_SYMMETRY_PARAMS: SymmetryEffectNode['params'] = {
  mode: 'reflection',
  sourceScope: 'sector',
  count: 2,
  directionDeg: 180,
  centerX: 4.5,
  centerY: 4.5,
};

export const SYMMETRY_NUMERIC_PARAMETERS = defineNumericParameterRules<
  SymmetryEffectNode['params']
>()({
  count: customNumericParameter({
    defaultValue: DEFAULT_SYMMETRY_PARAMS.count,
    min: MIN_SYMMETRY_RESULT_COUNT,
    max: MAX_SYMMETRY_RESULT_COUNT,
    step: 1,
    normalize: (value, params) => resolveSymmetryResultCount(
      params.mode === 'rotation' ? 'rotation' : 'reflection',
      value,
    ),
  }),
  directionDeg: cyclicNumericParameter({
    defaultValue: DEFAULT_SYMMETRY_PARAMS.directionDeg,
    min: 0,
    period: 360,
    step: 1,
    display: { unit: '°' },
    modulationMessageKey: 'control.symmetryDirection',
  }),
  centerX: boundedNumericParameter({
    defaultValue: DEFAULT_SYMMETRY_PARAMS.centerX,
    min: 0,
    max: 9,
    step: 0.5,
    modulationMessageKey: 'control.centerX',
  }),
  centerY: boundedNumericParameter({
    defaultValue: DEFAULT_SYMMETRY_PARAMS.centerY,
    min: 0,
    max: 9,
    step: 0.5,
    modulationMessageKey: 'control.centerY',
  }),
});

const isCurrentSymmetryParams = (
  params: Record<string, unknown>,
): params is SymmetryEffectNode['params'] => {
  if (
    params.mode !== 'reflection' && params.mode !== 'rotation'
    || params.sourceScope !== 'sector' && params.sourceScope !== 'entire'
    || typeof params.count !== 'number'
    || !Number.isInteger(params.count)
    || typeof params.directionDeg !== 'number'
    || !Number.isFinite(params.directionDeg)
    || params.directionDeg < 0
    || params.directionDeg >= 360
    || typeof params.centerX !== 'number'
    || !Number.isFinite(params.centerX)
    || params.centerX < 0
    || params.centerX > 9
    || typeof params.centerY !== 'number'
    || !Number.isFinite(params.centerY)
    || params.centerY < 0
    || params.centerY > 9
  ) {
    return false;
  }

  return params.count === resolveSymmetryResultCount(params.mode, params.count);
};

const createDefaultSymmetryNode = (
  id: string,
  enabled: boolean,
): SymmetryEffectNode => ({
  id,
  kind: 'symmetry',
  enabled,
  groupId: null,
  params: { ...DEFAULT_SYMMETRY_PARAMS },
});

const hydrateImportedSymmetryNode = (
  source: Record<string, unknown>,
): SymmetryEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultSymmetryNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  if (!isCurrentSymmetryParams(params)) {
    return null;
  }
  device.params = {
    mode: params.mode,
    sourceScope: params.sourceScope,
    count: params.count,
    directionDeg: params.directionDeg,
    centerX: params.centerX,
    centerY: params.centerY,
  };
  return device;
};

export const symmetryDeviceSchema = {
  kind: 'symmetry',
  label: 'Symmetry',
  group: 'effect',
  numericParameters: SYMMETRY_NUMERIC_PARAMETERS,
  createDefaultNode: createDefaultSymmetryNode,
  hydrateImportedNode: hydrateImportedSymmetryNode,
} satisfies RendererDeviceSchema<'symmetry'>;
