import {
  getRendererDeviceLabel,
  RENDERER_DEVICE_KINDS,
  type RendererDeviceKind,
} from '../../../devices';
import type { BrowserTreeDeviceFolderNode, BrowserTreeDeviceLeafNode } from '../../components/browser-tree-types';

export type DeviceBrowserCategoryId = 'generators' | 'transform' | 'time' | 'utility';

export interface DeviceBrowserCategoryDefinition {
  categoryId: DeviceBrowserCategoryId;
  id: string;
  label: string;
  accentColorVar: `--${string}`;
  deviceKinds: readonly RendererDeviceKind[];
}

const toDeviceLeafNode = (
  kind: RendererDeviceKind,
): BrowserTreeDeviceLeafNode => ({
  kind: 'device',
  id: `device:${kind}`,
  label: getRendererDeviceLabel(kind),
  deviceKind: kind,
});

const DEVICE_BROWSER_CATEGORY_DEFINITIONS = [
  {
    categoryId: 'generators',
    id: 'device-group:generators',
    label: 'Generators',
    accentColorVar: '--category-generators-500',
    deviceKinds: ['waterdrop', 'scanner', 'spiral', 'path'],
  },
  {
    categoryId: 'transform',
    id: 'device-group:transform',
    label: 'Transform',
    accentColorVar: '--category-transform-500',
    deviceKinds: ['mirror', 'symmetry', 'rotate', 'scale', 'translate'],
  },
  {
    categoryId: 'time',
    id: 'device-group:time',
    label: 'Time',
    accentColorVar: '--category-time-500',
    deviceKinds: ['trim', 'stretch', 'reverse'],
  },
  {
    categoryId: 'utility',
    id: 'device-group:utility',
    label: 'Utility',
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

for (const definition of DEVICE_BROWSER_CATEGORY_DEFINITIONS) {
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

export const DEVICE_BROWSER_TREE: BrowserTreeDeviceFolderNode[] =
  DEVICE_BROWSER_CATEGORY_DEFINITIONS.map((definition) => ({
    kind: 'folder',
    treeKind: 'device',
    id: definition.id,
    label: definition.label,
    children: definition.deviceKinds.map((kind) => toDeviceLeafNode(kind)),
  }));

export const getDeviceBrowserCategory = (
  kind: RendererDeviceKind,
): DeviceBrowserCategoryDefinition => {
  const category = DEVICE_BROWSER_CATEGORY_BY_KIND.get(kind);
  if (!category) {
    throw new Error(`Missing device browser category for kind: ${kind}`);
  }

  return category;
};

export const getDeviceBrowserIcon = (kind: RendererDeviceKind): string =>
  DEVICE_BROWSER_ICON_BY_KIND[kind];
