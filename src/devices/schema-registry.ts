import { colorDeviceSchema } from './color/schema';
import { maskDeviceSchema } from './mask/schema';
import { mirrorDeviceSchema } from './mirror/schema';
import { modulatorDeviceSchema } from './modulator/schema';
import { reverseDeviceSchema } from './reverse/schema';
import { rotateDeviceSchema } from './rotate/schema';
import { scannerDeviceSchema } from './scanner/schema';
import { spiralDeviceSchema } from './spiral/schema';
import { symmetryDeviceSchema } from './symmetry/schema';
import type {
  RendererDeviceGroup,
  RendererDeviceKind,
  RendererDeviceNodeOfKind,
  RendererDeviceSchema,
  RendererModulationParamDefinition,
} from './types';
import { waterdropDeviceSchema } from './waterdrop/schema';

const RENDERER_DEVICE_GROUP_ORDER = {
  generator: ['waterdrop', 'scanner', 'spiral'],
  effect: ['modulator', 'mirror', 'symmetry', 'mask', 'rotate', 'reverse', 'color'],
} as const satisfies Record<RendererDeviceGroup, readonly RendererDeviceKind[]>;

const rendererDeviceSchemas = {
  waterdrop: waterdropDeviceSchema,
  scanner: scannerDeviceSchema,
  spiral: spiralDeviceSchema,
  modulator: modulatorDeviceSchema,
  mirror: mirrorDeviceSchema,
  symmetry: symmetryDeviceSchema,
  mask: maskDeviceSchema,
  rotate: rotateDeviceSchema,
  reverse: reverseDeviceSchema,
  color: colorDeviceSchema,
} as const satisfies Record<RendererDeviceKind, RendererDeviceSchema>;

export const RENDERER_DEVICE_GROUPS = {
  generator: [...RENDERER_DEVICE_GROUP_ORDER.generator],
  effect: [...RENDERER_DEVICE_GROUP_ORDER.effect],
} as const;

export const RENDERER_DEVICE_KINDS = Object.freeze([
  ...RENDERER_DEVICE_GROUPS.generator,
  ...RENDERER_DEVICE_GROUPS.effect,
]) as readonly RendererDeviceKind[];

const RENDERER_DEVICE_KIND_SET = new Set<RendererDeviceKind>(RENDERER_DEVICE_KINDS);

export const isRendererDeviceKind = (
  value: string | undefined,
): value is RendererDeviceKind => (
  !!value && RENDERER_DEVICE_KIND_SET.has(value as RendererDeviceKind)
);

const getRendererDeviceSchema = <K extends RendererDeviceKind>(
  kind: K,
): RendererDeviceSchema<K> => rendererDeviceSchemas[kind] as RendererDeviceSchema<K>;

export const getRendererDeviceLabel = (kind: RendererDeviceKind): string =>
  rendererDeviceSchemas[kind].label;

export const getRendererDeviceGroup = (kind: RendererDeviceKind): RendererDeviceGroup =>
  rendererDeviceSchemas[kind].group;

export const getRendererModulationTargetParamDefinitions = (
  kind: RendererDeviceKind,
): readonly RendererModulationParamDefinition[] =>
  getRendererDeviceSchema(kind).modulationTargetParams ?? [];

export const createRendererDeviceNode = <K extends RendererDeviceKind>(
  kind: K,
  id: string,
  enabled = true,
): RendererDeviceNodeOfKind<K> =>
  getRendererDeviceSchema(kind).createDefaultNode(id, enabled);
