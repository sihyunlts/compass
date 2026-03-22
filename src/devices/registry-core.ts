import { colorDeviceControls } from './color/controls';
import { colorDeviceSchema } from './color/schema';
import type { RendererKindControlDefinition } from './control-types';
import { maskDeviceControls } from './mask/controls';
import { maskDeviceSchema } from './mask/schema';
import { mirrorDeviceControls } from './mirror/controls';
import { mirrorDeviceSchema } from './mirror/schema';
import { modulatorDeviceControls } from './modulator/controls';
import { modulatorDeviceSchema } from './modulator/schema';
import { reverseDeviceSchema } from './reverse/schema';
import { rotateDeviceControls } from './rotate/controls';
import { rotateDeviceSchema } from './rotate/schema';
import { scannerDeviceControls } from './scanner/controls';
import { scannerDeviceSchema } from './scanner/schema';
import { spiralDeviceControls } from './spiral/controls';
import { spiralDeviceSchema } from './spiral/schema';
import { symmetryDeviceControls } from './symmetry/controls';
import { symmetryDeviceSchema } from './symmetry/schema';
import type {
  RendererDeviceGroup,
  RendererDeviceKind,
  RendererDeviceNodeOfKind,
  RendererDeviceSchema,
  RendererModulationParamDefinition,
} from './types';
import { waterdropDeviceControls } from './waterdrop/controls';
import { waterdropDeviceSchema } from './waterdrop/schema';

type RendererDeviceSchemaEntry = {
  [K in RendererDeviceKind]: RendererDeviceSchema<K> & {
    controls?: RendererKindControlDefinition;
  };
}[RendererDeviceKind];

const defineRendererDeviceSchema = <K extends RendererDeviceKind>(
  definition: RendererDeviceSchema<K> & { controls?: RendererKindControlDefinition },
) => definition;

const rendererDeviceSchemaManifest = [
  defineRendererDeviceSchema({
    ...waterdropDeviceSchema,
    controls: waterdropDeviceControls,
  }),
  defineRendererDeviceSchema({
    ...scannerDeviceSchema,
    controls: scannerDeviceControls,
  }),
  defineRendererDeviceSchema({
    ...spiralDeviceSchema,
    controls: spiralDeviceControls,
  }),
  defineRendererDeviceSchema({
    ...modulatorDeviceSchema,
    controls: modulatorDeviceControls,
  }),
  defineRendererDeviceSchema({
    ...mirrorDeviceSchema,
    controls: mirrorDeviceControls,
  }),
  defineRendererDeviceSchema({
    ...symmetryDeviceSchema,
    controls: symmetryDeviceControls,
  }),
  defineRendererDeviceSchema({
    ...maskDeviceSchema,
    controls: maskDeviceControls,
  }),
  defineRendererDeviceSchema({
    ...rotateDeviceSchema,
    controls: rotateDeviceControls,
  }),
  defineRendererDeviceSchema({
    ...reverseDeviceSchema,
  }),
  defineRendererDeviceSchema({
    ...colorDeviceSchema,
    controls: colorDeviceControls,
  }),
] as const satisfies readonly RendererDeviceSchemaEntry[];

type RendererDeviceSchemaByKind = {
  [K in RendererDeviceKind]: Extract<RendererDeviceSchemaEntry, { kind: K }>;
};

const rendererDeviceSchemas = Object.fromEntries(
  rendererDeviceSchemaManifest.map((definition) => [definition.kind, definition]),
) as RendererDeviceSchemaByKind;

const collectRendererDeviceKindsByGroup = (
  group: RendererDeviceGroup,
): readonly RendererDeviceKind[] => Object.freeze(
  rendererDeviceSchemaManifest
    .filter((definition) => definition.group === group)
    .map((definition) => definition.kind),
);

export const RENDERER_DEVICE_GROUPS = {
  generator: collectRendererDeviceKindsByGroup('generator'),
  effect: collectRendererDeviceKindsByGroup('effect'),
} as const satisfies Record<RendererDeviceGroup, readonly RendererDeviceKind[]>;

export const RENDERER_DEVICE_KINDS = Object.freeze(
  rendererDeviceSchemaManifest.map((definition) => definition.kind),
) as readonly RendererDeviceKind[];

const RENDERER_DEVICE_KIND_SET = new Set<RendererDeviceKind>(RENDERER_DEVICE_KINDS);

export const getRendererDeviceSchema = <K extends RendererDeviceKind>(
  kind: K,
): RendererDeviceSchemaByKind[K] => rendererDeviceSchemas[kind];

export const isRendererDeviceKind = (
  value: string | undefined,
): value is RendererDeviceKind => (
  !!value && RENDERER_DEVICE_KIND_SET.has(value as RendererDeviceKind)
);

export const getRendererDeviceControlDefinition = <K extends RendererDeviceKind>(
  kind: K,
): RendererKindControlDefinition | null =>
  getRendererDeviceSchema(kind).controls ?? null;

export const getRendererDeviceLabel = (kind: RendererDeviceKind): string =>
  getRendererDeviceSchema(kind).label;

export const getRendererDeviceGroup = (kind: RendererDeviceKind): RendererDeviceGroup =>
  getRendererDeviceSchema(kind).group;

export const getRendererModulationTargetParamDefinitions = (
  kind: RendererDeviceKind,
): readonly RendererModulationParamDefinition[] =>
  getRendererDeviceSchema(kind).modulationTargetParams ?? [];

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
