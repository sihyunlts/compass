import type { LiveTempoUpdate } from '../../bridge/types';
import type { AppLocale } from '../../i18n';
import type { PresetFileKind } from '../../presets';
import type {
  CreatePresetFolderRequest,
  CreatePresetFolderResponse,
  DeletePresetEntriesRequest,
  DeletePresetEntriesResponse,
  ListPresetBrowserTreeResponse,
  MovePresetEntriesRequest,
  MovePresetEntriesResponse,
  ReadPresetEntryRequest,
  ReadPresetEntryResponse,
  RenamePresetFileRequest,
  RenamePresetFileResponse,
  RenamePresetFolderRequest,
  RenamePresetFolderResponse,
  SaveRackFileRequest,
  SaveRackFileResponse,
  SavePresetFileRequest,
  SavePresetFileResponse,
  ShowPresetEntryInFolderRequest,
  ShowPresetEntryInFolderResponse,
  UpdatePresetFileInfoRequest,
  UpdatePresetFileInfoResponse,
  UpdateRackFileInfoRequest,
  UpdateRackFileInfoResponse,
} from './presets';
import type { PreviewWindowState } from '../preview/window-state';
import type {
  RequestLiveTempoResponse,
  SendGeneratedPreviewRequest,
  SendGeneratedPreviewResponse,
} from './generator';
import type { UpdateCheckResponse } from './releases';

export interface MainWindowDocumentState {
  edited: boolean;
  filePath: string | null;
}

export type RackFileMenuAction = 'new' | 'save' | 'save-as';

export type PreviewWindowControlRequest =
  | { action: 'toggle-playback' }
  | { action: 'toggle-loop' }
  | { action: 'seek'; scrubValue: number };

export const parsePreviewWindowControlRequest = (
  value: unknown,
): PreviewWindowControlRequest | null => {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const action = (value as { action?: unknown }).action;
  if (action === 'toggle-playback' || action === 'toggle-loop') {
    return { action };
  }

  const scrubValue = (value as { scrubValue?: unknown }).scrubValue;
  if (action === 'seek' && typeof scrubValue === 'number' && Number.isFinite(scrubValue)) {
    return { action, scrubValue };
  }

  return null;
};

export interface CompassApi {
  sendGeneratedPreview: (
    request: SendGeneratedPreviewRequest,
  ) => Promise<SendGeneratedPreviewResponse>;
  requestAppVersion: () => Promise<string>;
  setApplicationLocale: (locale: AppLocale) => Promise<void>;
  checkForUpdates: () => Promise<UpdateCheckResponse>;
  openLatestReleasePage: () => Promise<void>;
  requestLiveTempo: () => Promise<RequestLiveTempoResponse>;
  openPreviewWindow: () => Promise<void>;
  sendPreviewWindowControlRequest: (request: PreviewWindowControlRequest) => void;
  pushPreviewWindowState: (state: PreviewWindowState) => void;
  requestPreviewWindowState: () => Promise<PreviewWindowState | null>;
  requestPreviewWindowVisibility: () => Promise<boolean>;
  subscribePreviewWindowState: (
    listener: (state: PreviewWindowState) => void,
  ) => () => void;
  subscribePreviewWindowVisibility: (
    listener: (isOpen: boolean) => void,
  ) => () => void;
  subscribePreviewWindowControlRequest: (
    listener: (request: PreviewWindowControlRequest) => void,
  ) => () => void;
  subscribeMainWindowCloseRequest: (
    listener: () => void,
  ) => () => void;
  subscribeMainWindowRackFileMenuRequest: (
    listener: (action: RackFileMenuAction) => void,
  ) => () => void;
  requestMainWindowAlwaysOnTop: () => Promise<boolean>;
  setMainWindowAlwaysOnTop: (enabled: boolean) => Promise<boolean>;
  confirmMainWindowClose: () => Promise<void>;
  pushMainWindowDocumentState: (state: MainWindowDocumentState) => void;
  subscribeLiveTempo: (
    listener: (update: LiveTempoUpdate) => void,
  ) => () => void;
  openExternal: (url: string) => Promise<void>;
  getPathForFile: (file: File) => string | null;
  savePresetFile: (
    request: SavePresetFileRequest,
  ) => Promise<SavePresetFileResponse>;
  saveRackFile: (
    request: SaveRackFileRequest,
  ) => Promise<SaveRackFileResponse>;
  updateRackFileInfo: (
    request: UpdateRackFileInfoRequest,
  ) => Promise<UpdateRackFileInfoResponse>;
  renamePresetFile: (
    request: RenamePresetFileRequest,
  ) => Promise<RenamePresetFileResponse>;
  updatePresetFileInfo: (
    request: UpdatePresetFileInfoRequest,
  ) => Promise<UpdatePresetFileInfoResponse>;
  createPresetFolder: (
    request: CreatePresetFolderRequest,
  ) => Promise<CreatePresetFolderResponse>;
  renamePresetFolder: (
    request: RenamePresetFolderRequest,
  ) => Promise<RenamePresetFolderResponse>;
  listPresetBrowserTree: () => Promise<ListPresetBrowserTreeResponse>;
  subscribePresetBrowserTreeChanged: (
    listener: () => void,
  ) => () => void;
  showPresetEntryInFolder: (
    request: ShowPresetEntryInFolderRequest,
  ) => Promise<ShowPresetEntryInFolderResponse>;
  deletePresetEntries: (
    request: DeletePresetEntriesRequest,
  ) => Promise<DeletePresetEntriesResponse>;
  movePresetEntries: (
    request: MovePresetEntriesRequest,
  ) => Promise<MovePresetEntriesResponse>;
  readPresetEntry: <K extends PresetFileKind>(
    request: ReadPresetEntryRequest<K>,
  ) => Promise<ReadPresetEntryResponse<K>>;
}
