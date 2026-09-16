import type { RendererDeviceKind } from '../../../devices';
import type { PresetFileKind } from '../../../shared/presets';
import { getDeviceBrowserIcon } from '../editor/device-browser-categories';

type PresetEntryPresentationNode =
  | { kind: 'folder'; icon?: string }
  | {
      kind: 'preset';
      loadStatus: 'loaded' | 'error';
      presetType: PresetFileKind;
      deviceKind?: RendererDeviceKind;
    };

export const resolvePresetBrowserEntryIcon = (
  node: PresetEntryPresentationNode,
): string => {
  if (node.kind === 'folder') return node.icon ?? 'folder';
  if (node.loadStatus === 'error') return 'error';
  if (node.presetType === 'device' && node.deviceKind) {
    return getDeviceBrowserIcon(node.deviceKind);
  }
  if (node.presetType === 'group') return 'combine_columns';
  if (node.presetType === 'rack') return 'view_week';
  return 'tune';
};
