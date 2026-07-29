import type { RendererDeviceKind } from '../devices';
import {
  getDeviceBrowserCategoryByDirectoryName,
  getDeviceBrowserKindByDirectoryPath,
  type DeviceBrowserCategoryId,
} from '../devices/browser-categories';
import type { MessageKey } from '../shared/i18n';
import type { PresetFileKind } from '../shared/presets';

type DeviceMessageKey = `device.${RendererDeviceKind}`;
type DeviceCategoryMessageKey = `browser.group.${DeviceBrowserCategoryId}`;

export const getDeviceMessageKey = (
  kind: RendererDeviceKind,
): DeviceMessageKey => `device.${kind}` as DeviceMessageKey;

export const getDeviceCategoryMessageKey = (
  categoryId: DeviceBrowserCategoryId,
): DeviceCategoryMessageKey =>
  `browser.group.${categoryId}` as DeviceCategoryMessageKey;

export const PRESET_ROOT_MESSAGE_KEY_BY_TYPE = {
  device: 'browser.presetRoot.devices',
  group: 'browser.presetRoot.groups',
  rack: 'browser.presetRoot.racks',
} as const satisfies Readonly<Record<PresetFileKind, MessageKey>>;

export const getPresetSystemFolderMessageKey = (
  presetType: PresetFileKind,
  relativePath: readonly string[],
): MessageKey | null => {
  if (relativePath.length === 0) {
    return PRESET_ROOT_MESSAGE_KEY_BY_TYPE[presetType];
  }
  if (presetType !== 'device') {
    return null;
  }

  if (relativePath.length === 1) {
    const category = getDeviceBrowserCategoryByDirectoryName(relativePath[0]);
    return category
      ? getDeviceCategoryMessageKey(category.categoryId)
      : null;
  }

  if (relativePath.length === 2) {
    const kind = getDeviceBrowserKindByDirectoryPath(
      relativePath[0],
      relativePath[1],
    );
    return kind ? getDeviceMessageKey(kind) : null;
  }

  return null;
};
