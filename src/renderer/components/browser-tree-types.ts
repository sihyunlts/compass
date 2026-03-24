import type { RendererDeviceKind } from '../../devices';
import type { PresetFileKind } from '../../shared/presets';

interface BrowserTreeBaseFolderNode {
  kind: 'folder';
  id: string;
  label: string;
  children: BrowserTreeNode[];
}

export interface BrowserTreeDeviceFolderNode extends BrowserTreeBaseFolderNode {
  treeKind: 'device';
}

export interface BrowserTreePresetFolderNode extends BrowserTreeBaseFolderNode {
  treeKind: 'preset';
  presetType: PresetFileKind;
  relativePath: string[];
}

export interface BrowserTreeDeviceLeafNode {
  kind: 'device';
  id: string;
  label: string;
  deviceKind: RendererDeviceKind;
}

export interface BrowserTreePresetLeafNode {
  kind: 'preset';
  id: string;
  label: string;
  presetType: PresetFileKind;
  relativePath: string[];
  savedAtIso: string;
}

export interface PendingPresetFolderDraft {
  temporaryId: string;
  presetType: PresetFileKind;
  parentRelativePath: string[];
  draftName: string;
}

export interface PresetFolderSelectionTarget {
  token: number;
  presetType: PresetFileKind;
  relativePath: string[];
}

export type BrowserTreeNode =
  | BrowserTreeDeviceFolderNode
  | BrowserTreePresetFolderNode
  | BrowserTreeDeviceLeafNode
  | BrowserTreePresetLeafNode;
