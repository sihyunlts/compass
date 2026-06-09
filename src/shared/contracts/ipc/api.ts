import type { LiveTempoUpdate } from '../../bridge/types';
import type { PresetFileKind } from '../../presets';
import type {
  CreatePresetFolderRequest,
  CreatePresetFolderResponse,
  DeletePresetEntryRequest,
  DeletePresetEntryResponse,
  ListPresetBrowserTreeResponse,
  ReadPresetEntryRequest,
  ReadPresetEntryResponse,
  RenamePresetFolderRequest,
  RenamePresetFolderResponse,
  SaveRackFileRequest,
  SaveRackFileResponse,
  SavePresetFileRequest,
  SavePresetFileResponse,
  ShowPresetEntryInFolderRequest,
  ShowPresetEntryInFolderResponse,
  ShowPresetsRootInFolderResponse,
} from './presets';
import type { PreviewWindowState } from '../preview/window-state';
import type {
  GenerateAndSendRequest,
  GenerateAndSendResponse,
  RequestLiveTempoResponse,
} from './generator';

export interface MainWindowDocumentState {
  edited: boolean;
  filePath: string | null;
}

export interface CompassApi {
  generateAndSend: (
    request: GenerateAndSendRequest,
  ) => Promise<GenerateAndSendResponse>;
  requestAppVersion: () => Promise<string>;
  requestLiveTempo: () => Promise<RequestLiveTempoResponse>;
  openPreviewWindow: () => Promise<void>;
  pushPreviewWindowState: (state: PreviewWindowState) => void;
  requestPreviewWindowState: () => Promise<PreviewWindowState | null>;
  requestPreviewWindowVisibility: () => Promise<boolean>;
  subscribePreviewWindowState: (
    listener: (state: PreviewWindowState) => void,
  ) => () => void;
  subscribePreviewWindowVisibility: (
    listener: (isOpen: boolean) => void,
  ) => () => void;
  subscribeMainWindowCloseRequest: (
    listener: () => void,
  ) => () => void;
  confirmMainWindowClose: () => Promise<void>;
  pushMainWindowDocumentState: (state: MainWindowDocumentState) => void;
  subscribeLiveTempo: (
    listener: (update: LiveTempoUpdate) => void,
  ) => () => void;
  openExternal: (url: string) => Promise<void>;
  savePresetFile: (
    request: SavePresetFileRequest,
  ) => Promise<SavePresetFileResponse>;
  saveRackFile: (
    request: SaveRackFileRequest,
  ) => Promise<SaveRackFileResponse>;
  createPresetFolder: (
    request: CreatePresetFolderRequest,
  ) => Promise<CreatePresetFolderResponse>;
  renamePresetFolder: (
    request: RenamePresetFolderRequest,
  ) => Promise<RenamePresetFolderResponse>;
  listPresetBrowserTree: () => Promise<ListPresetBrowserTreeResponse>;
  showPresetEntryInFolder: (
    request: ShowPresetEntryInFolderRequest,
  ) => Promise<ShowPresetEntryInFolderResponse>;
  showPresetsRootInFolder: () => Promise<ShowPresetsRootInFolderResponse>;
  deletePresetEntry: (
    request: DeletePresetEntryRequest,
  ) => Promise<DeletePresetEntryResponse>;
  readPresetEntry: <K extends PresetFileKind>(
    request: ReadPresetEntryRequest<K>,
  ) => Promise<ReadPresetEntryResponse<K>>;
}
