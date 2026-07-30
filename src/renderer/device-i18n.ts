import type { RendererDeviceKind } from '../devices';
import type { DeviceBrowserCategoryId } from '../devices/browser-categories';

type DeviceMessageKey = `device.${RendererDeviceKind}`;
type DeviceCategoryMessageKey = `browser.group.${DeviceBrowserCategoryId}`;

export const getDeviceMessageKey = (
  kind: RendererDeviceKind,
): DeviceMessageKey => `device.${kind}` as DeviceMessageKey;

export const getDeviceCategoryMessageKey = (
  categoryId: DeviceBrowserCategoryId,
): DeviceCategoryMessageKey =>
  `browser.group.${categoryId}` as DeviceCategoryMessageKey;
