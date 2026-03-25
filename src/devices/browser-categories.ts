import { getRendererDeviceLabel, RENDERER_DEVICE_KINDS } from './registry-core';
import type { RendererDeviceKind } from './types';

export type DeviceBrowserCategoryId = 'generators' | 'transform' | 'time' | 'utility';

export interface DeviceBrowserCategoryDefinition {
  categoryId: DeviceBrowserCategoryId;
  label: string;
  directoryName: string;
  accentColorVar: `--${string}`;
  deviceKinds: readonly RendererDeviceKind[];
}

export const DEVICE_BROWSER_CATEGORY_DEFINITIONS = [
  {
    categoryId: 'generators',
    label: 'Generators',
    directoryName: 'Generators',
    accentColorVar: '--category-generators-500',
    deviceKinds: ['waterdrop', 'scanner', 'spiral', 'path'],
  },
  {
    categoryId: 'transform',
    label: 'Transform',
    directoryName: 'Transform',
    accentColorVar: '--category-transform-500',
    deviceKinds: ['mirror', 'symmetry', 'rotate', 'scale', 'translate'],
  },
  {
    categoryId: 'time',
    label: 'Time',
    directoryName: 'Time',
    accentColorVar: '--category-time-500',
    deviceKinds: ['trim', 'stretch', 'reverse'],
  },
  {
    categoryId: 'utility',
    label: 'Utility',
    directoryName: 'Utility',
    accentColorVar: '--category-utility-500',
    deviceKinds: ['mask', 'color', 'modulator'],
  },
] as const satisfies readonly DeviceBrowserCategoryDefinition[];

const validateDeviceBrowserCategories = (
  definitions: readonly DeviceBrowserCategoryDefinition[],
): void => {
  const expectedKinds = new Set(RENDERER_DEVICE_KINDS);
  const seenKinds = new Set<RendererDeviceKind>();

  for (const definition of definitions) {
    for (const kind of definition.deviceKinds) {
      if (!expectedKinds.has(kind)) {
        throw new Error(`Unknown device browser category kind: ${kind}`);
      }
      if (seenKinds.has(kind)) {
        throw new Error(`Duplicate device browser category kind: ${kind}`);
      }
      seenKinds.add(kind);
    }
  }

  const missingKinds = RENDERER_DEVICE_KINDS.filter((kind) => !seenKinds.has(kind));
  if (missingKinds.length > 0) {
    throw new Error(`Missing device browser category kinds: ${missingKinds.join(', ')}`);
  }
};

validateDeviceBrowserCategories(DEVICE_BROWSER_CATEGORY_DEFINITIONS);

const DEVICE_BROWSER_CATEGORY_BY_KIND = new Map<RendererDeviceKind, DeviceBrowserCategoryDefinition>();
const DEVICE_BROWSER_CATEGORY_ORDER = new Map<string, number>();

for (const [index, definition] of DEVICE_BROWSER_CATEGORY_DEFINITIONS.entries()) {
  DEVICE_BROWSER_CATEGORY_ORDER.set(definition.directoryName, index);
  for (const kind of definition.deviceKinds) {
    DEVICE_BROWSER_CATEGORY_BY_KIND.set(kind, definition);
  }
}

const DEVICE_BROWSER_ICON_BY_KIND: Record<RendererDeviceKind, string> = {
  waterdrop: 'water_drop',
  scanner: 'scan',
  spiral: 'cyclone',
  path: 'line_end_diamond',
  mirror: 'flip',
  symmetry: 'balance',
  rotate: 'rotate_right',
  scale: 'resize',
  translate: 'open_with',
  trim: 'content_cut',
  stretch: 'fit_width',
  reverse: 'swap_horiz',
  mask: 'grid_view',
  color: 'palette',
  modulator: 'show_chart',
};

export const getDeviceBrowserCategory = (
  kind: RendererDeviceKind,
): DeviceBrowserCategoryDefinition => {
  const category = DEVICE_BROWSER_CATEGORY_BY_KIND.get(kind);
  if (!category) {
    throw new Error(`Missing device browser category for kind: ${kind}`);
  }

  return category;
};

export const getDeviceBrowserCategoryDirectoryName = (
  kind: RendererDeviceKind,
): string => getDeviceBrowserCategory(kind).directoryName;

export const compareDeviceBrowserCategoryDirectoryNames = (
  left: string,
  right: string,
): number => {
  const leftOrder = DEVICE_BROWSER_CATEGORY_ORDER.get(left);
  const rightOrder = DEVICE_BROWSER_CATEGORY_ORDER.get(right);

  if (leftOrder == null || rightOrder == null) {
    return left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }

  return leftOrder - rightOrder;
};

export const getDeviceBrowserIcon = (kind: RendererDeviceKind): string =>
  DEVICE_BROWSER_ICON_BY_KIND[kind];

export const getDeviceBrowserTreeLabel = (kind: RendererDeviceKind): string =>
  getRendererDeviceLabel(kind);
