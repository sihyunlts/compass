import {
  DEVICE_BROWSER_CATEGORY_DEFINITIONS,
  getDeviceBrowserCategory,
  getDeviceBrowserIcon,
  getDeviceBrowserTreeLabel,
  type DeviceBrowserCategoryDefinition,
  type DeviceBrowserCategoryId,
} from '../../../devices/browser-categories';
import type { BrowserTreeDeviceFolderNode, BrowserTreeDeviceLeafNode } from '../../components/browser-tree-types';

const toDeviceLeafNode = (
  kind: DeviceBrowserCategoryDefinition['deviceKinds'][number],
): BrowserTreeDeviceLeafNode => ({
  kind: 'device',
  id: `device:${kind}`,
  label: getDeviceBrowserTreeLabel(kind),
  deviceKind: kind,
});

export const DEVICE_BROWSER_TREE: BrowserTreeDeviceFolderNode[] =
  DEVICE_BROWSER_CATEGORY_DEFINITIONS.map((definition) => ({
    kind: 'folder',
    treeKind: 'device',
    id: `device-group:${definition.categoryId}`,
    label: definition.label,
    children: definition.deviceKinds.map((kind) => toDeviceLeafNode(kind)),
  }));

export {
  getDeviceBrowserCategory,
  getDeviceBrowserIcon,
  type DeviceBrowserCategoryDefinition,
  type DeviceBrowserCategoryId,
};
