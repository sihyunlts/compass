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

export interface OpenPresetFileRequest<K extends PresetFileKind = PresetFileKind> {
  presetType: K;
}

export type OpenPresetFileResponse<K extends PresetFileKind = PresetFileKind> =
  | {
      status: 'opened';
      filePath: string;
      payload: PresetFileByKind<K>;
      warning?: string;
    }
  | {
      status: 'canceled';
    }
  | {
      status: 'error';
      message: string;
      filePath?: string;
    };
