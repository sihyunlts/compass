import type { TranslateEffectNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
} from '../import-hydration';
import {
  defineNumericParameterRules,
  finiteNumericParameter,
  hydrateImportedNumericParameters,
} from '../numeric-parameters';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_TRANSLATE_PARAMS: TranslateEffectNode['params'] = {
  offsetX: 0,
  offsetY: 0,
};

export const TRANSLATE_NUMERIC_PARAMETERS = defineNumericParameterRules<
  TranslateEffectNode['params']
>()({
  offsetX: finiteNumericParameter({
    defaultValue: DEFAULT_TRANSLATE_PARAMS.offsetX,
    step: 0.1,
    modulationMessageKey: 'control.offsetX',
  }),
  offsetY: finiteNumericParameter({
    defaultValue: DEFAULT_TRANSLATE_PARAMS.offsetY,
    step: 0.1,
    modulationMessageKey: 'control.offsetY',
  }),
});

const createDefaultTranslateNode = (
  id: string,
  enabled: boolean,
): TranslateEffectNode => ({
  id,
  kind: 'translate',
  enabled,
  groupId: null,
  params: { ...DEFAULT_TRANSLATE_PARAMS },
});

const hydrateImportedTranslateNode = (
  source: Record<string, unknown>,
): TranslateEffectNode | null => {
  const id = resolveImportedDeviceId(source);
  if (!id) {
    return null;
  }

  const device = applyImportedDeviceMeta(
    createDefaultTranslateNode(id, resolveImportedDeviceEnabled(source)),
    source,
  );
  const params = resolveImportedParams(source);
  hydrateImportedNumericParameters(device.params, params, TRANSLATE_NUMERIC_PARAMETERS);
  return device;
};

export const translateDeviceSchema = {
  kind: 'translate',
  label: 'Translate',
  group: 'effect',
  numericParameters: TRANSLATE_NUMERIC_PARAMETERS,
  createDefaultNode: createDefaultTranslateNode,
  hydrateImportedNode: hydrateImportedTranslateNode,
} satisfies RendererDeviceSchema<'translate'>;
