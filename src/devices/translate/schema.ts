import type { TranslateEffectNode } from '../../shared/model';
import {
  applyImportedDeviceMeta,
  resolveImportedDeviceEnabled,
  resolveImportedDeviceId,
  resolveImportedParams,
  toFiniteNumber,
} from '../import-hydration';
import type { RendererDeviceSchema } from '../types';

const DEFAULT_TRANSLATE_PARAMS: TranslateEffectNode['params'] = {
  offsetX: 0,
  offsetY: 0,
};

const TRANSLATE_MODULATION_TARGET_PARAMS = [
  { key: 'offsetX', label: 'Offset X' },
  { key: 'offsetY', label: 'Offset Y' },
] as const;
export const TRANSLATE_NUMERIC_PARAM_KEYS = ['offsetX', 'offsetY'] as const;

const createDefaultTranslateNode = (
  id: string,
  enabled: boolean,
): TranslateEffectNode => ({
  id,
  kind: 'translate',
  enabled: enabled !== false,
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
  device.params.offsetX = toFiniteNumber(params.offsetX, device.params.offsetX);
  device.params.offsetY = toFiniteNumber(params.offsetY, device.params.offsetY);
  return device;
};

export const translateDeviceSchema = {
  kind: 'translate',
  label: 'Translate',
  group: 'effect',
  modulationTargetParams: TRANSLATE_MODULATION_TARGET_PARAMS,
  numericParamKeys: TRANSLATE_NUMERIC_PARAM_KEYS,
  createDefaultNode: createDefaultTranslateNode,
  hydrateImportedNode: hydrateImportedTranslateNode,
} satisfies RendererDeviceSchema<'translate'>;
