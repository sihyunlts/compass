import type { MirrorEffectNode } from '../../shared/model';
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

const DEFAULT_MIRROR_PARAMS: MirrorEffectNode['params'] = {
  angleDeg: 90,
};

export const MIRROR_NUMERIC_PARAMETERS = defineNumericParameterRules<
  MirrorEffectNode['params']
>()({
  angleDeg: cyclicNumericParameter({
    defaultValue: DEFAULT_MIRROR_PARAMS.angleDeg,
    min: 0,
    period: 360,
    step: 1,
    display: { unit: '°' },
    modulationMessageKey: 'control.mirrorAxisAngle',
  }),
});

const createDefaultMirrorNode = (
  id: string,
  enabled: boolean,
): MirrorEffectNode => ({
  id,
  kind: 'mirror',
  enabled: enabled !== false,
  groupId: null,
  params: { ...DEFAULT_MIRROR_PARAMS },
});

const hydrateImportedMirrorNode = (
  source: Record<string, unknown>,
): MirrorEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultMirrorNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  hydrateImportedNumericParameters(device.params, params, MIRROR_NUMERIC_PARAMETERS);
  return device;
};

export const mirrorDeviceSchema = {
  kind: 'mirror',
  label: 'Mirror',
  group: 'effect',
  numericParameters: MIRROR_NUMERIC_PARAMETERS,
  createDefaultNode: createDefaultMirrorNode,
  hydrateImportedNode: hydrateImportedMirrorNode,
} satisfies RendererDeviceSchema<'mirror'>;
