import {
  getRendererDeviceLabel,
  RENDERER_DEVICE_KINDS,
  type RendererDeviceKind,
} from '../../../devices';
import type { BrowserTreeDeviceFolderNode, BrowserTreeDeviceLeafNode } from '../../components/browser-tree-types';

interface DeviceBrowserCategoryDefinition {
  id: string;
  label: string;
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
    id: 'device-group:generators',
    label: 'Generators',
    deviceKinds: ['waterdrop', 'scanner', 'spiral', 'path'],
  },
  {
    id: 'device-group:transform',
    label: 'Transform',
    deviceKinds: ['mirror', 'symmetry', 'rotate', 'scale', 'translate'],
  },
  {
    id: 'device-group:time',
    label: 'Time',
    deviceKinds: ['trim', 'stretch', 'reverse'],
  },
  {
    id: 'device-group:utility',
    label: 'Utility',
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

export const DEVICE_BROWSER_TREE: BrowserTreeDeviceFolderNode[] =
  DEVICE_BROWSER_CATEGORY_DEFINITIONS.map((definition) => ({
    kind: 'folder',
    treeKind: 'device',
    id: definition.id,
    label: definition.label,
    children: definition.deviceKinds.map((kind) => toDeviceLeafNode(kind)),
  }));
