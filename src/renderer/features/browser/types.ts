import type { RendererDeviceKind } from '../../../devices';
import type { DeviceBrowserCategoryId } from '../../../devices/browser-categories';
import type { PresetEntrySelectionItem } from '../../../shared/preset-entry-selection';
import type {
  PresetBrowserPreview,
  PresetFileKind,
} from '../../../shared/presets';

interface BrowserTreeBaseFolderNode {
  kind: 'folder';
  id: string;
  label: string;
  children: BrowserTreeNode[];
}

export interface BrowserTreeDeviceFolderNode extends BrowserTreeBaseFolderNode {
  treeKind: 'device';
  categoryId: DeviceBrowserCategoryId;
  presetRelativePath: string[];
  presetDirectoryExists: boolean;
}

export interface BrowserTreePresetFolderNode extends BrowserTreeBaseFolderNode {
  treeKind: 'preset';
  presetType: PresetFileKind;
  relativePath: string[];
}

export interface BrowserTreeDeviceNode {
  kind: 'device';
  id: string;
  label: string;
  deviceKind: RendererDeviceKind;
  presetRelativePath: string[];
  presetDirectoryExists: boolean;
  children: BrowserTreeNode[];
}

export interface BrowserTreePresetLeafNode {
  kind: 'preset';
  id: string;
  label: string;
  presetType: PresetFileKind;
  relativePath: string[];
  savedAtIso: string;
  deviceKind?: RendererDeviceKind;
  preview?: PresetBrowserPreview;
}

export interface PendingPresetFolderDraft {
  mode: 'create' | 'rename';
  entryKind: 'file' | 'directory';
  presetType: PresetFileKind;
  relativePath: string[];
  draftName: string;
  temporaryId?: string;
}

export interface PresetEntrySelectionTarget {
  token: number;
  entries: PresetEntrySelectionItem[];
}

export type BrowserTreeNode =
  | BrowserTreeDeviceFolderNode
  | BrowserTreePresetFolderNode
  | BrowserTreeDeviceNode
  | BrowserTreePresetLeafNode;

export type BrowserPage = 'devices' | 'groups' | 'racks' | 'settings';
