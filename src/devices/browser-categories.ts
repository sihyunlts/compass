import { getRendererDeviceLabel, RENDERER_DEVICE_KINDS } from './registry-core';
import type { RendererDeviceKind } from './types';

export type DeviceBrowserCategoryId = 'generate' | 'transform' | 'time' | 'utility';

export interface DeviceBrowserCategoryDefinition {
  categoryId: DeviceBrowserCategoryId;
  label: string;
  directoryName: string;
  accentColorVar: `--${string}`;
  deviceKinds: readonly RendererDeviceKind[];
}

export const GENERATE_DEVICE_CATEGORY_DIRECTORY_NAME = 'Generate';

export const DEVICE_BROWSER_CATEGORY_DEFINITIONS = [
  {
    categoryId: 'generate',
    label: 'Generate',
    directoryName: GENERATE_DEVICE_CATEGORY_DIRECTORY_NAME,
    accentColorVar: '--color-category-generate',
    deviceKinds: ['ripple', 'scanner', 'rain', 'spiral', 'path'],
  },
  {
    categoryId: 'transform',
    label: 'Transform',
    directoryName: 'Transform',
    accentColorVar: '--color-category-transform',
    deviceKinds: ['mirror', 'symmetry', 'rotate', 'scale', 'translate'],
  },
  {
    categoryId: 'time',
    label: 'Time',
    directoryName: 'Time',
    accentColorVar: '--color-category-time',
    deviceKinds: ['trim', 'stretch', 'timewarp', 'reverse'],
  },
  {
    categoryId: 'utility',
    label: 'Utility',
    directoryName: 'Utility',
    accentColorVar: '--color-category-utility',
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
const DEVICE_BROWSER_CATEGORY_BY_DIRECTORY_NAME = new Map<
  string,
  DeviceBrowserCategoryDefinition
>();
const DEVICE_BROWSER_KIND_BY_DIRECTORY_PATH = new Map<string, RendererDeviceKind>();
const DEVICE_BROWSER_CATEGORY_ORDER = new Map<string, number>();

for (const [index, definition] of DEVICE_BROWSER_CATEGORY_DEFINITIONS.entries()) {
  DEVICE_BROWSER_CATEGORY_BY_DIRECTORY_NAME.set(definition.directoryName, definition);
  DEVICE_BROWSER_CATEGORY_ORDER.set(definition.directoryName, index);
  for (const kind of definition.deviceKinds) {
    DEVICE_BROWSER_CATEGORY_BY_KIND.set(kind, definition);
    DEVICE_BROWSER_KIND_BY_DIRECTORY_PATH.set(
      `${definition.directoryName}\0${getRendererDeviceLabel(kind)}`,
      kind,
    );
  }
}

const DEVICE_BROWSER_ICON_BY_KIND: Record<RendererDeviceKind, string> = {
  ripple: 'water_drop',
  scanner: 'scan',
  rain: 'rainy',
  spiral: 'cyclone',
  path: 'line_end_diamond',
  mirror: 'flip',
  symmetry: 'balance',
  rotate: 'rotate_right',
  scale: 'resize',
  translate: 'open_with',
  trim: 'content_cut',
  stretch: 'fit_width',
  timewarp: 'timeline',
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

export const getDeviceBrowserCategoryByDirectoryName = (
  directoryName: string,
): DeviceBrowserCategoryDefinition | null =>
  DEVICE_BROWSER_CATEGORY_BY_DIRECTORY_NAME.get(directoryName) ?? null;

export const getDeviceBrowserKindByDirectoryPath = (
  categoryDirectoryName: string,
  deviceDirectoryName: string,
): RendererDeviceKind | null =>
  DEVICE_BROWSER_KIND_BY_DIRECTORY_PATH.get(
    `${categoryDirectoryName}\0${deviceDirectoryName}`,
  ) ?? null;

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
