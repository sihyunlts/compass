import type { AuthoredMetadata, GeneratorDeviceNode } from '../../model';
import type {
  PresetEntryPath,
  PresetEntrySelectionItem,
} from '../../preset-entry-selection';
import type {
  PresetBrowserPreview,
  PresetFile,
  PresetFileErrorCode,
  PresetFileKind,
  RackPresetFile,
} from '../../presets';

type RendererDeviceKind = GeneratorDeviceNode['kind'];

export interface SavePresetFileRequest {
  suggestedName: string;
  payload: PresetFile;
}

type PresetFileByKind<K extends PresetFileKind> = Extract<
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

export interface SaveRackFileRequest {
  filePath: string;
  payload: RackPresetFile;
}

export type SaveRackFileResponse =
  | {
      status: 'saved';
      filePath: string;
    }
  | {
      status: 'error';
      message: string;
      filePath?: string;
    };

export interface UpdateRackFileInfoRequest {
  filePath: string;
  fileName: string;
  metadata?: AuthoredMetadata;
}

export type UpdateRackFileInfoResponse =
  | {
      status: 'updated';
      filePath: string;
      savedAtIso: string;
    }
  | {
      status: 'error';
      message: string;
      filePath?: string;
    };

export interface RenamePresetFileRequest<K extends PresetFileKind = PresetFileKind> {
  presetType: K;
  relativePath: string[];
  fileName: string;
}

export type RenamePresetFileResponse =
  | {
      status: 'renamed';
      relativePath: string[];
      sourcePath: string;
      filePath: string;
    }
  | {
      status: 'error';
      message: string;
    };

export interface UpdatePresetFileInfoRequest<K extends PresetFileKind = PresetFileKind> {
  presetType: K;
  relativePath: string[];
  fileName: string;
  metadata?: AuthoredMetadata;
}

export type UpdatePresetFileInfoResponse =
  | {
      status: 'updated';
      relativePath: string[];
      sourcePath: string;
      filePath: string;
      savedAtIso: string;
    }
  | {
      status: 'error';
      message: string;
    };

export interface CreatePresetFolderRequest<K extends PresetFileKind = PresetFileKind> {
  presetType: K;
  relativePath: string[];
  folderName: string;
}

export type CreatePresetFolderResponse =
  | {
      status: 'ok';
      relativePath: string[];
    }
  | {
      status: 'error';
      message: string;
    };

export interface RenamePresetFolderRequest<K extends PresetFileKind = PresetFileKind> {
  presetType: K;
  relativePath: string[];
  folderName: string;
}

export type RenamePresetFolderResponse =
  | {
      status: 'ok';
      relativePath: string[];
      sourcePath: string;
      filePath: string;
    }
  | {
      status: 'error';
      message: string;
    };

interface PresetBrowserTreeLeafNodeBase<K extends PresetFileKind = PresetFileKind> {
  kind: 'preset';
  id: string;
  label: string;
  presetType: K;
  relativePath: string[];
}

type PresetBrowserTreeLeafNode<K extends PresetFileKind = PresetFileKind> =
  PresetBrowserTreeLeafNodeBase<K> & (
    | {
        loadStatus: 'loaded';
        savedAtIso: string;
        deviceKind?: RendererDeviceKind;
        preview?: PresetBrowserPreview;
        loadErrorCode?: never;
      }
    | {
        loadStatus: 'error';
        loadErrorCode: PresetFileErrorCode;
        savedAtIso?: never;
        deviceKind?: never;
        preview?: never;
      }
  );

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
      occupiedPaths: PresetEntryPath[];
    }
  | {
      status: 'error';
      message: string;
    };

export interface ReadPresetEntryRequest<K extends PresetFileKind = PresetFileKind> {
  presetType: K;
  relativePath: string[];
}

export interface ShowPresetEntryInFolderRequest<K extends PresetFileKind = PresetFileKind>
  extends PresetEntrySelectionItem {
  presetType: K;
  relativePath: string[];
}

type DeletePresetEntryRequest<K extends PresetFileKind = PresetFileKind> =
  ShowPresetEntryInFolderRequest<K>;

export interface DeletePresetEntriesRequest {
  entries: DeletePresetEntryRequest[];
}

export interface DeletedPresetEntry extends DeletePresetEntryRequest {
  filePath: string;
}

export interface MovePresetEntriesRequest {
  entries: DeletePresetEntryRequest[];
  destination: ReadPresetEntryRequest;
}

export interface MovedPresetEntry extends DeletePresetEntryRequest {
  sourcePath: string;
  filePath: string;
}

export type ShowPresetEntryInFolderResponse =
  | {
      status: 'ok';
    }
  | {
      status: 'error';
      message: string;
    };

export type DeletePresetEntriesResponse =
  | {
      status: 'ok';
      entries: DeletedPresetEntry[];
    }
  | {
      status: 'error';
      message: string;
    };

export type MovePresetEntriesResponse =
  | {
      status: 'ok';
      entries: MovedPresetEntry[];
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
      needsSave: boolean;
    }
  | {
      status: 'error';
      errorCode: PresetFileErrorCode;
      message: string;
      filePath?: string;
    };
