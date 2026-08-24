import {
  DEVICE_BROWSER_CATEGORY_DEFINITIONS,
  getDeviceBrowserCategory,
  getDeviceBrowserCategoryById,
  getDeviceBrowserIcon,
  getDeviceBrowserTreeLabel,
  type DeviceBrowserCategoryDefinition,
  type DeviceBrowserCategoryId,
} from '../../../devices/browser-categories';
import type {
  BrowserTreeDeviceFolderNode,
  BrowserTreeDeviceNode,
  BrowserTreeNode,
  BrowserTreePresetFolderNode,
} from '../browser/types';

const toDeviceLeafNode = (
  kind: DeviceBrowserCategoryDefinition['deviceKinds'][number],
  categoryDirectoryName: string,
): BrowserTreeDeviceNode => ({
  kind: 'device',
  id: `device:${kind}`,
  label: getDeviceBrowserTreeLabel(kind),
  deviceKind: kind,
  presetRelativePath: [categoryDirectoryName, getDeviceBrowserTreeLabel(kind)],
  presetDirectoryExists: false,
  children: [],
});

export const DEVICE_BROWSER_TREE: BrowserTreeDeviceFolderNode[] =
  DEVICE_BROWSER_CATEGORY_DEFINITIONS.map((definition) => ({
    kind: 'folder',
    treeKind: 'device',
    categoryId: definition.categoryId,
    id: `device-group:${definition.categoryId}`,
    label: definition.label,
    presetRelativePath: [definition.directoryName],
    presetDirectoryExists: false,
    children: definition.deviceKinds.map((kind) =>
      toDeviceLeafNode(kind, definition.directoryName)),
  }));

const hasRelativePath = (
  node: BrowserTreePresetFolderNode,
  relativePath: readonly string[],
): boolean =>
  node.relativePath.length === relativePath.length
  && node.relativePath.every(
    (segment, index) => segment === relativePath[index],
  );

export const mergeDevicePresetTree = (
  deviceTree: readonly BrowserTreeDeviceFolderNode[],
  presetRoot: BrowserTreePresetFolderNode | null,
): BrowserTreeNode[] => {
  const presetRootChildren = presetRoot?.children ?? [];
  const consumedRootNodeIds = new Set<string>();

  const mergedCategories = deviceTree.map((category) => {
    const presetCategory = presetRootChildren.find(
      (node): node is BrowserTreePresetFolderNode =>
        node.kind === 'folder'
        && node.treeKind === 'preset'
        && hasRelativePath(node, category.presetRelativePath),
    ) ?? null;
    if (presetCategory) {
      consumedRootNodeIds.add(presetCategory.id);
    }

    const consumedCategoryNodeIds = new Set<string>();
    const devices = category.children.map((node) => {
      if (node.kind !== 'device') {
        return node;
      }

      const presetDevice = presetCategory?.children.find(
        (child): child is BrowserTreePresetFolderNode =>
          child.kind === 'folder'
          && child.treeKind === 'preset'
          && hasRelativePath(child, node.presetRelativePath),
      ) ?? null;
      if (presetDevice) {
        consumedCategoryNodeIds.add(presetDevice.id);
      }

      return {
        ...node,
        presetDirectoryExists: presetDevice !== null,
        children: presetDevice ? [...presetDevice.children] : [],
      };
    });
    const unmatchedPresetNodes = presetCategory?.children.filter(
      (node) => !consumedCategoryNodeIds.has(node.id),
    ) ?? [];

    return {
      ...category,
      presetDirectoryExists: presetCategory !== null,
      children: [...devices, ...unmatchedPresetNodes],
    };
  });

  return [
    ...mergedCategories,
    ...presetRootChildren.filter((node) => !consumedRootNodeIds.has(node.id)),
  ];
};

export const getDeviceBrowserCategoryIcon = (
  categoryId: DeviceBrowserCategoryId,
): string => getDeviceBrowserCategoryById(categoryId).icon;

export const getDeviceBrowserCategoryAccentColorVar = (
  categoryId: DeviceBrowserCategoryId,
): DeviceBrowserCategoryDefinition['accentColorVar'] =>
  getDeviceBrowserCategoryById(categoryId).accentColorVar;

export {
  getDeviceBrowserCategory,
  getDeviceBrowserIcon,
};
