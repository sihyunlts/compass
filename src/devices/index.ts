import ColorDeviceUi from './color/ui.svelte';
import {
  getRendererDeviceGroup,
  getRendererDeviceLabel,
  getRendererDeviceSchema,
  getRendererModulationTargetParamDefinitions,
  isRendererDeviceKind,
  RENDERER_DEVICE_GROUPS,
  RENDERER_DEVICE_KINDS,
} from './metadata';
import MaskDeviceUi from './mask/ui.svelte';
import MirrorDeviceUi from './mirror/ui.svelte';
import ModulatorDeviceUi from './modulator/ui.svelte';
import ReverseDeviceUi from './reverse/ui.svelte';
import RotateDeviceUi from './rotate/ui.svelte';
import ScannerDeviceUi from './scanner/ui.svelte';
import SpiralDeviceUi from './spiral/ui.svelte';
import SymmetryDeviceUi from './symmetry/ui.svelte';
import type {
  RendererDeviceDefinition,
  RendererDeviceKind,
} from './types';
import WaterdropDeviceUi from './waterdrop/ui.svelte';

export type {
  RendererDeviceDefinition,
  RendererDeviceEditorProps,
  RendererDeviceSchema,
  RendererDeviceGroup,
  RendererDeviceKind,
  RendererModulationParamDefinition,
} from './types';

export const rendererDeviceDefinitions = {
  waterdrop: {
    ...getRendererDeviceSchema('waterdrop'),
    editor: WaterdropDeviceUi,
  },
  scanner: {
    ...getRendererDeviceSchema('scanner'),
    editor: ScannerDeviceUi,
  },
  spiral: {
    ...getRendererDeviceSchema('spiral'),
    editor: SpiralDeviceUi,
  },
  modulator: {
    ...getRendererDeviceSchema('modulator'),
    editor: ModulatorDeviceUi,
  },
  mirror: {
    ...getRendererDeviceSchema('mirror'),
    editor: MirrorDeviceUi,
  },
  symmetry: {
    ...getRendererDeviceSchema('symmetry'),
    editor: SymmetryDeviceUi,
  },
  mask: {
    ...getRendererDeviceSchema('mask'),
    editor: MaskDeviceUi,
  },
  rotate: {
    ...getRendererDeviceSchema('rotate'),
    editor: RotateDeviceUi,
  },
  reverse: {
    ...getRendererDeviceSchema('reverse'),
    editor: ReverseDeviceUi,
  },
  color: {
    ...getRendererDeviceSchema('color'),
    editor: ColorDeviceUi,
  },
} as const satisfies Record<RendererDeviceKind, RendererDeviceDefinition>;

export const getRendererDeviceDefinition = (
  kind: RendererDeviceKind,
): RendererDeviceDefinition => rendererDeviceDefinitions[kind];

export {
  getRendererDeviceGroup,
  getRendererDeviceLabel,
  getRendererModulationTargetParamDefinitions,
  isRendererDeviceKind,
  RENDERER_DEVICE_GROUPS,
  RENDERER_DEVICE_KINDS,
};
