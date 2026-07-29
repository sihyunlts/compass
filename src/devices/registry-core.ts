import type { GeneratorDeviceNode } from '../shared/model';
import { colorDeviceSchema } from './color/schema';
import { maskDeviceSchema } from './mask/schema';
import { mirrorDeviceSchema } from './mirror/schema';
import { modulatorDeviceSchema } from './modulator/schema';
import {
  readNumericParameterValue,
  writeNumericParameterValue,
  type ModulationParameterDefinition,
  type NumericParameterRule,
} from './numeric-parameters';
import { pathDeviceSchema } from './path/schema';
import { rainDeviceSchema } from './rain/schema';
import { reverseDeviceSchema } from './reverse/schema';
import { rotateDeviceSchema } from './rotate/schema';
import { scannerDeviceSchema } from './scanner/schema';
import { scaleDeviceSchema } from './scale/schema';
import { spiralDeviceSchema } from './spiral/schema';
import { stretchDeviceSchema } from './stretch/schema';
import { symmetryDeviceSchema } from './symmetry/schema';
import { timeWarpDeviceSchema } from './timewarp/schema';
import { trimDeviceSchema } from './trim/schema';
import { translateDeviceSchema } from './translate/schema';
import type {
  RendererDeviceGroup,
  RendererDeviceKind,
  RendererDeviceNodeOfKind,
  RendererDeviceSchema,
} from './types';
import { waterdropDeviceSchema } from './waterdrop/schema';

type RendererDeviceSchemaEntry = {
  [K in RendererDeviceKind]: RendererDeviceSchema<K>;
}[RendererDeviceKind];

export const RENDERER_DEVICE_SCHEMAS = [
  waterdropDeviceSchema,
  scannerDeviceSchema,
  rainDeviceSchema,
  spiralDeviceSchema,
  pathDeviceSchema,
  modulatorDeviceSchema,
  mirrorDeviceSchema,
  rotateDeviceSchema,
  scaleDeviceSchema,
  translateDeviceSchema,
  symmetryDeviceSchema,
  maskDeviceSchema,
  trimDeviceSchema,
  stretchDeviceSchema,
  timeWarpDeviceSchema,
  reverseDeviceSchema,
  colorDeviceSchema,
] as const satisfies readonly RendererDeviceSchemaEntry[];

type RendererDeviceSchemaByKind = {
  [K in RendererDeviceKind]: Extract<RendererDeviceSchemaEntry, { kind: K }>;
};

const rendererDeviceSchemas = Object.fromEntries(
  RENDERER_DEVICE_SCHEMAS.map((schema) => [schema.kind, schema]),
) as RendererDeviceSchemaByKind;

const collectRendererDeviceKindsByGroup = (
  group: RendererDeviceGroup,
): readonly RendererDeviceKind[] => Object.freeze(
  RENDERER_DEVICE_SCHEMAS
    .filter((schema) => schema.group === group)
    .map((schema) => schema.kind),
);

export const RENDERER_DEVICE_GROUPS = {
  generator: collectRendererDeviceKindsByGroup('generator'),
  effect: collectRendererDeviceKindsByGroup('effect'),
} as const satisfies Record<RendererDeviceGroup, readonly RendererDeviceKind[]>;

export const RENDERER_DEVICE_KINDS = Object.freeze(
  RENDERER_DEVICE_SCHEMAS.map((schema) => schema.kind),
) as readonly RendererDeviceKind[];

const RENDERER_DEVICE_KIND_SET = new Set<RendererDeviceKind>(RENDERER_DEVICE_KINDS);

const getRendererDeviceSchema = <K extends RendererDeviceKind>(
  kind: K,
): RendererDeviceSchemaByKind[K] => rendererDeviceSchemas[kind];

const getNumericParameterRules = (
  kind: RendererDeviceKind,
): Readonly<Record<string, NumericParameterRule>> | null => {
  const schema = getRendererDeviceSchema(kind) as RendererDeviceSchema;
  return schema.numericParameters as Readonly<Record<string, NumericParameterRule>> | undefined
    ?? null;
};

export const getNumericParameterRule = (
  kind: RendererDeviceKind,
  paramKey: string,
): NumericParameterRule | null =>
  getNumericParameterRules(kind)?.[paramKey] ?? null;

const getModulationParameterDefinitions = (
  kind: RendererDeviceKind,
): readonly ModulationParameterDefinition[] =>
  Object.entries(getNumericParameterRules(kind) ?? {}).flatMap(([key, rule]) => (
    rule.modulationLabel
      ? [{
          key,
          label: rule.modulationLabel,
          unit: rule.display.unit,
        }]
      : []
  ));

export const isModulationTargetDeviceKind = (
  kind: RendererDeviceKind,
): boolean => getModulationParameterDefinitions(kind).length > 0;

export const isModulationTargetParamKey = (
  kind: RendererDeviceKind,
  paramKey: string,
): boolean => Boolean(getNumericParameterRule(kind, paramKey)?.modulationLabel);

export const readNumericDeviceParam = (
  device: GeneratorDeviceNode,
  paramKey: string,
): number | null => {
  const rules = getNumericParameterRules(device.kind);
  if (!rules || !('params' in device)) {
    return null;
  }
  return readNumericParameterValue(device.params, rules, paramKey);
};

export const writeNumericDeviceParam = (
  device: GeneratorDeviceNode,
  paramKey: string,
  value: unknown,
  step?: number,
): number | null => {
  const rules = getNumericParameterRules(device.kind);
  if (!rules || !('params' in device)) {
    return null;
  }
  return writeNumericParameterValue(device.params, rules, paramKey, value, { step });
};

export const isRendererDeviceKind = (
  value: string | undefined,
): value is RendererDeviceKind => (
  !!value && RENDERER_DEVICE_KIND_SET.has(value as RendererDeviceKind)
);

export const getRendererDeviceLabel = (kind: RendererDeviceKind): string =>
  getRendererDeviceSchema(kind).label;

export const getRendererDeviceGroup = (kind: RendererDeviceKind): RendererDeviceGroup =>
  getRendererDeviceSchema(kind).group;

export const getRendererModulationTargetParamDefinitions = (
  kind: RendererDeviceKind,
): readonly ModulationParameterDefinition[] =>
  getModulationParameterDefinitions(kind);

export const createRendererDeviceNode = <K extends RendererDeviceKind>(
  kind: K,
  id: string,
  enabled = true,
): RendererDeviceNodeOfKind<K> =>
  getRendererDeviceSchema(kind).createDefaultNode(id, enabled) as RendererDeviceNodeOfKind<K>;

export const hydrateImportedRendererDeviceNode = <K extends RendererDeviceKind>(
  kind: K,
  source: Record<string, unknown>,
): RendererDeviceNodeOfKind<K> | null =>
  getRendererDeviceSchema(kind).hydrateImportedNode(source) as RendererDeviceNodeOfKind<K> | null;
