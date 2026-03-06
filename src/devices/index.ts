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
import SpiralDeviceUi from './spiral/ui.svelte';
import { spiralDeviceControls } from './spiral/controls';
import { spiralDeviceSchema } from './spiral/schema';
import SymmetryDeviceUi from './symmetry/ui.svelte';
import { symmetryDeviceControls } from './symmetry/controls';
import { symmetryDeviceSchema } from './symmetry/schema';
import type {
  RendererDeviceDefinition,
  RendererDeviceKind,
} from './types';
import WaterdropDeviceUi from './waterdrop/ui.svelte';
import { waterdropDeviceControls } from './waterdrop/controls';
import { waterdropDeviceSchema } from './waterdrop/schema';

const waterdropDeviceDefinition = {
  ...waterdropDeviceSchema,
  editor: WaterdropDeviceUi,
  controls: waterdropDeviceControls,
} as const;

const scannerDeviceDefinition = {
  ...scannerDeviceSchema,
  editor: ScannerDeviceUi,
  controls: scannerDeviceControls,
} as const;

const spiralDeviceDefinition = {
  ...spiralDeviceSchema,
  editor: SpiralDeviceUi,
  controls: spiralDeviceControls,
} as const;

const modulatorDeviceDefinition = {
  ...modulatorDeviceSchema,
  editor: ModulatorDeviceUi,
  controls: modulatorDeviceControls,
} as const;

const mirrorDeviceDefinition = {
  ...mirrorDeviceSchema,
  editor: MirrorDeviceUi,
  controls: mirrorDeviceControls,
} as const;

const symmetryDeviceDefinition = {
  ...symmetryDeviceSchema,
  editor: SymmetryDeviceUi,
  controls: symmetryDeviceControls,
} as const;

const maskDeviceDefinition = {
  ...maskDeviceSchema,
  editor: MaskDeviceUi,
  controls: maskDeviceControls,
} as const;

const rotateDeviceDefinition = {
  ...rotateDeviceSchema,
  editor: RotateDeviceUi,
  controls: rotateDeviceControls,
} as const;

const reverseDeviceDefinition = {
  ...reverseDeviceSchema,
  editor: ReverseDeviceUi,
} as const;

const colorDeviceDefinition = {
  ...colorDeviceSchema,
  editor: ColorDeviceUi,
  controls: colorDeviceControls,
} as const;

const rendererDeviceDefinitions = {
  waterdrop: waterdropDeviceDefinition,
  scanner: scannerDeviceDefinition,
  spiral: spiralDeviceDefinition,
  modulator: modulatorDeviceDefinition,
  mirror: mirrorDeviceDefinition,
  symmetry: symmetryDeviceDefinition,
  mask: maskDeviceDefinition,
  rotate: rotateDeviceDefinition,
  reverse: reverseDeviceDefinition,
  color: colorDeviceDefinition,
} as const satisfies Record<RendererDeviceKind, RendererDeviceDefinition>;

export type {
  RendererDeviceKind,
} from './types';

export {
  createRendererDeviceNode,
  getRendererDeviceGroup,
  getRendererDeviceLabel,
  getRendererModulationTargetParamDefinitions,
  isRendererDeviceKind,
  RENDERER_DEVICE_GROUPS,
  RENDERER_DEVICE_KINDS,
} from './schema-registry';

export const getRendererDeviceDefinition = <K extends RendererDeviceKind>(
  kind: K,
): (typeof rendererDeviceDefinitions)[K] => rendererDeviceDefinitions[kind];

export const getRendererDeviceControlDefinition = <K extends RendererDeviceKind>(
  kind: K,
): RendererKindControlDefinition | null => {
  const definition = rendererDeviceDefinitions[kind];
  return 'controls' in definition ? definition.controls ?? null : null;
};
