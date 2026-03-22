import ColorDeviceUi from './color/ui.svelte';
import { colorDeviceControls } from './color/controls';
import { colorDeviceSchema } from './color/schema';
import type { RendererKindControlDefinition } from './control-types';
import MaskDeviceUi from './mask/ui.svelte';
import { maskDeviceControls } from './mask/controls';
import { maskDeviceSchema } from './mask/schema';
import MirrorDeviceUi from './mirror/ui.svelte';
import { mirrorDeviceControls } from './mirror/controls';
import { mirrorDeviceSchema } from './mirror/schema';
import ModulatorDeviceUi from './modulator/ui.svelte';
import { modulatorDeviceControls } from './modulator/controls';
import { modulatorDeviceSchema } from './modulator/schema';
import ReverseDeviceUi from './reverse/ui.svelte';
import { reverseDeviceSchema } from './reverse/schema';
import RotateDeviceUi from './rotate/ui.svelte';
import { rotateDeviceControls } from './rotate/controls';
import { rotateDeviceSchema } from './rotate/schema';
import ScannerDeviceUi from './scanner/ui.svelte';
import { scannerDeviceControls } from './scanner/controls';
import { scannerDeviceSchema } from './scanner/schema';
import { spiralDeviceControls } from './spiral/controls';
import { spiralDeviceSchema } from './spiral/schema';
import SpiralDeviceUi from './spiral/ui.svelte';
import SymmetryDeviceUi from './symmetry/ui.svelte';
import { symmetryDeviceControls } from './symmetry/controls';
import { symmetryDeviceSchema } from './symmetry/schema';
import type {
  RendererDeviceDefinition,
  RendererDeviceGroup,
  RendererDeviceKind,
  RendererDeviceNodeOfKind,
  RendererModulationParamDefinition,
} from './types';
import WaterdropDeviceUi from './waterdrop/ui.svelte';
import { waterdropDeviceControls } from './waterdrop/controls';
import { waterdropDeviceSchema } from './waterdrop/schema';

type RendererDeviceManifestEntry = {
  [K in RendererDeviceKind]: RendererDeviceDefinition<K>;
}[RendererDeviceKind];

const defineRendererDevice = <K extends RendererDeviceKind>(
  definition: RendererDeviceDefinition<K>,
): RendererDeviceDefinition<K> => definition;

const rendererDeviceManifest = [
  defineRendererDevice({
    ...waterdropDeviceSchema,
    editor: WaterdropDeviceUi,
    controls: waterdropDeviceControls,
  }),
  defineRendererDevice({
    ...scannerDeviceSchema,
    editor: ScannerDeviceUi,
    controls: scannerDeviceControls,
  }),
  defineRendererDevice({
    ...spiralDeviceSchema,
    editor: SpiralDeviceUi,
    controls: spiralDeviceControls,
  }),
  defineRendererDevice({
    ...modulatorDeviceSchema,
    editor: ModulatorDeviceUi,
    controls: modulatorDeviceControls,
  }),
  defineRendererDevice({
    ...mirrorDeviceSchema,
    editor: MirrorDeviceUi,
    controls: mirrorDeviceControls,
  }),
  defineRendererDevice({
    ...symmetryDeviceSchema,
    editor: SymmetryDeviceUi,
    controls: symmetryDeviceControls,
  }),
  defineRendererDevice({
    ...maskDeviceSchema,
    editor: MaskDeviceUi,
    controls: maskDeviceControls,
  }),
  defineRendererDevice({
    ...rotateDeviceSchema,
    editor: RotateDeviceUi,
    controls: rotateDeviceControls,
  }),
  defineRendererDevice({
    ...reverseDeviceSchema,
    editor: ReverseDeviceUi,
  }),
  defineRendererDevice({
    ...colorDeviceSchema,
    editor: ColorDeviceUi,
    controls: colorDeviceControls,
  }),
] as const satisfies readonly RendererDeviceManifestEntry[];

type RendererDeviceDefinitionByKind = {
  [K in RendererDeviceKind]: Extract<RendererDeviceManifestEntry, { kind: K }>;
};

const rendererDeviceDefinitions = Object.fromEntries(
  rendererDeviceManifest.map((definition) => [definition.kind, definition]),
) as RendererDeviceDefinitionByKind;

const collectRendererDeviceKindsByGroup = (
  group: RendererDeviceGroup,
): readonly RendererDeviceKind[] => Object.freeze(
  rendererDeviceManifest
    .filter((definition) => definition.group === group)
    .map((definition) => definition.kind),
);

export const RENDERER_DEVICE_GROUPS = {
  generator: collectRendererDeviceKindsByGroup('generator'),
  effect: collectRendererDeviceKindsByGroup('effect'),
} as const satisfies Record<RendererDeviceGroup, readonly RendererDeviceKind[]>;

export const RENDERER_DEVICE_KINDS = Object.freeze(
  rendererDeviceManifest.map((definition) => definition.kind),
) as readonly RendererDeviceKind[];

const RENDERER_DEVICE_KIND_SET = new Set<RendererDeviceKind>(RENDERER_DEVICE_KINDS);

const getRendererDeviceSchema = <K extends RendererDeviceKind>(
  kind: K,
): RendererDeviceDefinitionByKind[K] => rendererDeviceDefinitions[kind];

export type {
  RendererDeviceKind,
} from './types';

export const isRendererDeviceKind = (
  value: string | undefined,
): value is RendererDeviceKind => (
  !!value && RENDERER_DEVICE_KIND_SET.has(value as RendererDeviceKind)
);

export const getRendererDeviceDefinition = <K extends RendererDeviceKind>(
  kind: K,
): RendererDeviceDefinitionByKind[K] => rendererDeviceDefinitions[kind];

export const getRendererDeviceControlDefinition = <K extends RendererDeviceKind>(
  kind: K,
): RendererKindControlDefinition | null =>
  getRendererDeviceDefinition(kind).controls ?? null;

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
