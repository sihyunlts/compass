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
  RenameRackFileRequest,
  RenameRackFileResponse,
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
  RequestLiveTempoResponse,
  SendGeneratedPreviewRequest,
  SendGeneratedPreviewResponse,
} from './generator';

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
  savePresetFile: (
    request: SavePresetFileRequest,
  ) => Promise<SavePresetFileResponse>;
  saveRackFile: (
    request: SaveRackFileRequest,
  ) => Promise<SaveRackFileResponse>;
  renameRackFile: (
    request: RenameRackFileRequest,
  ) => Promise<RenameRackFileResponse>;
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
