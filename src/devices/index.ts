import ColorDeviceUi from './color/ui.svelte';
import { colorDeviceControls } from './color/controls';
import { colorDeviceSchema } from './color/schema';
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
import {
  createRendererDeviceNode,
  getRendererDeviceControlDefinition,
  getRendererDeviceGroup,
  getRendererDeviceLabel,
  getRendererModulationTargetParamDefinitions,
  hydrateImportedRendererDeviceNode,
  isRendererDeviceKind,
  RENDERER_DEVICE_GROUPS,
  RENDERER_DEVICE_KINDS,
} from './registry-core';
import type {
  RendererDeviceDefinition,
  RendererDeviceKind,
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

export type {
  RendererDeviceKind,
} from './types';

export const getRendererDeviceDefinition = <K extends RendererDeviceKind>(
  kind: K,
): RendererDeviceDefinitionByKind[K] => rendererDeviceDefinitions[kind];

export {
  createRendererDeviceNode,
  getRendererDeviceControlDefinition,
  getRendererDeviceGroup,
  getRendererDeviceLabel,
  getRendererModulationTargetParamDefinitions,
  hydrateImportedRendererDeviceNode,
  isRendererDeviceKind,
  RENDERER_DEVICE_GROUPS,
  RENDERER_DEVICE_KINDS,
};
