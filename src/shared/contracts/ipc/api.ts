import type { LiveTempoUpdate } from '../../bridge/types';
import type {
  OpenPresetFileRequest,
  OpenPresetFileResponse,
  SavePresetFileRequest,
  SavePresetFileResponse,
} from './presets';
import type { PreviewWindowState } from '../preview/window-state';
import type {
  GenerateAndSendRequest,
  GenerateAndSendResponse,
  RequestLiveTempoResponse,
} from './generator';

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
  requestPreviewGuideEnabledUpdate: (enabled: boolean) => Promise<void>;
  subscribePreviewWindowState: (
    listener: (state: PreviewWindowState) => void,
  ) => () => void;
  subscribePreviewWindowVisibility: (
    listener: (isOpen: boolean) => void,
  ) => () => void;
  subscribePreviewGuideEnabledUpdate: (
    listener: (enabled: boolean) => void,
  ) => () => void;
  subscribeLiveTempo: (
    listener: (update: LiveTempoUpdate) => void,
  ) => () => void;
  openExternal: (url: string) => Promise<void>;
  savePresetFile: (
    request: SavePresetFileRequest,
  ) => Promise<SavePresetFileResponse>;
  openPresetFile: (
    request: OpenPresetFileRequest,
  ) => Promise<OpenPresetFileResponse>;
}
