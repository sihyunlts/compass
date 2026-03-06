import {
  getRendererDeviceLabel,
  RENDERER_DEVICE_GROUPS,
} from '../../devices';
import type { RendererDeviceKind } from '../../devices';

export interface BrowserDeviceCatalogItem {
  kind: RendererDeviceKind;
  label: string;
}

const toBrowserCatalogItems = (
  kinds: readonly RendererDeviceKind[],
): BrowserDeviceCatalogItem[] => kinds.map((kind) => ({
  kind,
  label: getRendererDeviceLabel(kind),
}));

export const BROWSER_GENERATORS = toBrowserCatalogItems(
  RENDERER_DEVICE_GROUPS.generator,
);

export const BROWSER_EFFECTS = toBrowserCatalogItems(
  RENDERER_DEVICE_GROUPS.effect,
);
