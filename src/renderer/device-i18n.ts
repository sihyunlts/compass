import { resolveControlParameterLabelKey } from '../devices/control-helpers';
import type { RendererControlDescriptor } from '../devices/control-types';
import { i18n } from './i18n.svelte';
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

export const createDeviceControlLabelResolver = <
  Controls extends { descriptors: Record<string, RendererControlDescriptor> },
>(controls: Controls) => (
  action: keyof Controls['descriptors'],
  paramKey?: string,
): string => i18n.t(resolveControlParameterLabelKey(controls.descriptors[action as string], paramKey));
