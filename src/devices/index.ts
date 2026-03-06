import { colorDeviceDefinition } from './color/index';
import { maskDeviceDefinition } from './mask/index';
import { mirrorDeviceDefinition } from './mirror/index';
import { modulatorDeviceDefinition } from './modulator/index';
import { reverseDeviceDefinition } from './reverse/index';
import { rotateDeviceDefinition } from './rotate/index';
import { scannerDeviceDefinition } from './scanner/index';
import { spiralDeviceDefinition } from './spiral/index';
import { symmetryDeviceDefinition } from './symmetry/index';
import type { RendererKindControlDefinition } from './control-types';
import type {
  RendererDeviceDefinition,
  RendererDeviceKind,
} from './types';
import { waterdropDeviceDefinition } from './waterdrop/index';

export const rendererDeviceDefinitions = {
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
  RendererDeviceDefinition,
  RendererDeviceEditorProps,
  RendererDeviceSchema,
  RendererDeviceGroup,
  RendererDeviceKind,
  RendererModulationParamDefinition,
} from './types';

export {
  createRendererDeviceNode,
  getRendererDeviceGroup,
  getRendererDeviceLabel,
  getRendererDeviceSchema,
  getRendererModulationTargetParamDefinitions,
  getRendererNumericParamKeys,
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
