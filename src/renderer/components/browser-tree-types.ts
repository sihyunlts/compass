import type { RendererDeviceKind } from '../../devices';
import type { PresetFileKind } from '../../shared/presets';

export interface BrowserTreeFolderNode {
  kind: 'folder';
  id: string;
  label: string;
  children: BrowserTreeNode[];
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

export type BrowserTreeNode =
  | BrowserTreeFolderNode
  | BrowserTreeDeviceLeafNode
  | BrowserTreePresetLeafNode;
