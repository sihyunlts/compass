import type { PresetFile, PresetFileKind } from '../../presets';

export interface SavePresetFileRequest {
  suggestedName: string;
  payload: PresetFile;
}

export type PresetFileByKind<K extends PresetFileKind> = Extract<
  PresetFile,
  { presetType: K }
>;

export type SavePresetFileResponse =
  | {
      status: 'saved';
      filePath: string;
    }
  | {
      status: 'canceled';
    }
  | {
      status: 'error';
      message: string;
      filePath?: string;
    };

export interface PresetBrowserTreeLeafNode<K extends PresetFileKind = PresetFileKind> {
  kind: 'preset';
  id: string;
  label: string;
  presetType: K;
  relativePath: string[];
  savedAtIso: string;
}

export interface PresetBrowserTreeFolderNode {
  kind: 'folder';
  id: string;
  label: string;
  presetType: PresetFileKind;
  relativePath: string[];
  children: PresetBrowserTreeNode[];
}

export type PresetBrowserTreeNode =
  | PresetBrowserTreeFolderNode
  | PresetBrowserTreeLeafNode;

export type ListPresetBrowserTreeResponse =
  | {
      status: 'ok';
      tree: PresetBrowserTreeFolderNode[];
    }
  | {
      status: 'error';
      message: string;
    };

export interface ReadPresetEntryRequest<K extends PresetFileKind = PresetFileKind> {
  presetType: K;
  relativePath: string[];
}

export interface ShowPresetEntryInFolderRequest<K extends PresetFileKind = PresetFileKind> {
  presetType: K;
  relativePath: string[];
  entryKind: 'file' | 'directory';
}

export type DeletePresetEntryRequest<K extends PresetFileKind = PresetFileKind> =
  ShowPresetEntryInFolderRequest<K>;

export type ShowPresetEntryInFolderResponse =
  | {
      status: 'ok';
    }
  | {
      status: 'error';
      message: string;
    };

export type ShowPresetsRootInFolderResponse =
  | {
      status: 'ok';
    }
  | {
      status: 'error';
      message: string;
    };

export type DeletePresetEntryResponse =
  | {
      status: 'ok';
    }
  | {
      status: 'error';
      message: string;
    };

export type ReadPresetEntryResponse<K extends PresetFileKind = PresetFileKind> =
  | {
      status: 'loaded';
      filePath: string;
      payload: PresetFileByKind<K>;
      warning?: string;
    }
  | {
      status: 'error';
      message: string;
      filePath?: string;
    };
