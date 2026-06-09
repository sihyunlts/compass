import { colorDeviceControls } from './color/controls';
import { colorDeviceSchema } from './color/schema';
import type { RendererKindControlDefinition } from './control-types';
import { maskDeviceControls } from './mask/controls';
import { maskDeviceSchema } from './mask/schema';
import { mirrorDeviceControls } from './mirror/controls';
import { mirrorDeviceSchema } from './mirror/schema';
import { modulatorDeviceControls } from './modulator/controls';
import { modulatorDeviceSchema } from './modulator/schema';
import { pathDeviceControls } from './path/controls';
import { pathDeviceSchema } from './path/schema';
import { reverseDeviceSchema } from './reverse/schema';
import { rotateDeviceControls } from './rotate/controls';
import { rotateDeviceSchema } from './rotate/schema';
import { scannerDeviceControls } from './scanner/controls';
import { scannerDeviceSchema } from './scanner/schema';
import { scaleDeviceControls } from './scale/controls';
import { scaleDeviceSchema } from './scale/schema';
import { spiralDeviceControls } from './spiral/controls';
import { spiralDeviceSchema } from './spiral/schema';
import { stretchDeviceControls } from './stretch/controls';
import { stretchDeviceSchema } from './stretch/schema';
import { symmetryDeviceControls } from './symmetry/controls';
import { symmetryDeviceSchema } from './symmetry/schema';
import { timeWarpDeviceControls } from './timewarp/controls';
import { timeWarpDeviceSchema } from './timewarp/schema';
import { trimDeviceControls } from './trim/controls';
import { trimDeviceSchema } from './trim/schema';
import { translateDeviceControls } from './translate/controls';
import { translateDeviceSchema } from './translate/schema';
import type {
  RendererDeviceGroup,
  RendererDeviceKind,
  RendererDeviceNodeOfKind,
  RendererDeviceSchema,
  RendererModulationParamDefinition,
} from './types';
import { waterdropDeviceControls } from './waterdrop/controls';
import { waterdropDeviceSchema } from './waterdrop/schema';

export type RendererDeviceEditorModulePath = `./${string}/ui.svelte`;

export type RendererDeviceManifestEntry = {
  [K in RendererDeviceKind]: RendererDeviceSchema<K> & {
    controls?: RendererKindControlDefinition;
    editor: RendererDeviceEditorModulePath;
  };
}[RendererDeviceKind];

export const RENDERER_DEVICE_MANIFEST = [
  {
    ...waterdropDeviceSchema,
    controls: waterdropDeviceControls,
    editor: './waterdrop/ui.svelte',
  },
  {
    ...scannerDeviceSchema,
    controls: scannerDeviceControls,
    editor: './scanner/ui.svelte',
  },
  {
    ...spiralDeviceSchema,
    controls: spiralDeviceControls,
    editor: './spiral/ui.svelte',
  },
  {
    ...pathDeviceSchema,
    controls: pathDeviceControls,
    editor: './path/ui.svelte',
  },
  {
    ...modulatorDeviceSchema,
    controls: modulatorDeviceControls,
    editor: './modulator/ui.svelte',
  },
  {
    ...mirrorDeviceSchema,
    controls: mirrorDeviceControls,
    editor: './mirror/ui.svelte',
  },
  {
    ...rotateDeviceSchema,
    controls: rotateDeviceControls,
    editor: './rotate/ui.svelte',
  },
  {
    ...scaleDeviceSchema,
    controls: scaleDeviceControls,
    editor: './scale/ui.svelte',
  },
  {
    ...translateDeviceSchema,
    controls: translateDeviceControls,
    editor: './translate/ui.svelte',
  },
  {
    ...symmetryDeviceSchema,
    controls: symmetryDeviceControls,
    editor: './symmetry/ui.svelte',
  },
  {
    ...maskDeviceSchema,
    controls: maskDeviceControls,
    editor: './mask/ui.svelte',
  },
  {
    ...trimDeviceSchema,
    controls: trimDeviceControls,
    editor: './trim/ui.svelte',
  },
  {
    ...stretchDeviceSchema,
    controls: stretchDeviceControls,
    editor: './stretch/ui.svelte',
  },
  {
    ...timeWarpDeviceSchema,
    controls: timeWarpDeviceControls,
    editor: './timewarp/ui.svelte',
  },
  {
    ...reverseDeviceSchema,
    editor: './reverse/ui.svelte',
  },
  {
    ...colorDeviceSchema,
    controls: colorDeviceControls,
    editor: './color/ui.svelte',
  },
] as const satisfies readonly RendererDeviceManifestEntry[];

export type RendererDeviceSchemaEntry = {
  [K in RendererDeviceKind]: RendererDeviceSchema<K> & {
    controls?: RendererKindControlDefinition;
  };
}[RendererDeviceKind];

type RendererDeviceSchemaByKind = {
  [K in RendererDeviceKind]: Extract<RendererDeviceSchemaEntry, { kind: K }>;
};

const toRendererDeviceSchema = (
  definition: RendererDeviceManifestEntry,
): RendererDeviceSchemaEntry => {
  const { editor, ...schema } = definition;
  void editor;
  return schema;
};

const rendererDeviceSchemas = Object.fromEntries(
  RENDERER_DEVICE_MANIFEST.map((definition) => {
    const schema = toRendererDeviceSchema(definition);
    return [schema.kind, schema];
  }),
) as RendererDeviceSchemaByKind;

const collectRendererDeviceKindsByGroup = (
  group: RendererDeviceGroup,
): readonly RendererDeviceKind[] => Object.freeze(
  RENDERER_DEVICE_MANIFEST
    .filter((definition) => definition.group === group)
    .map((definition) => definition.kind),
);

export const RENDERER_DEVICE_GROUPS = {
  generator: collectRendererDeviceKindsByGroup('generator'),
  effect: collectRendererDeviceKindsByGroup('effect'),
} as const satisfies Record<RendererDeviceGroup, readonly RendererDeviceKind[]>;

export const RENDERER_DEVICE_KINDS = Object.freeze(
  RENDERER_DEVICE_MANIFEST.map((definition) => definition.kind),
) as readonly RendererDeviceKind[];

const RENDERER_DEVICE_KIND_SET = new Set<RendererDeviceKind>(RENDERER_DEVICE_KINDS);

const getRendererDeviceSchema = <K extends RendererDeviceKind>(
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
