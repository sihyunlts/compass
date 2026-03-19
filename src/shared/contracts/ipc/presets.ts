import type { PresetFile, PresetFileKind } from '../../presets';

export interface SavePresetFileRequest {
  presetType: PresetFileKind;
  suggestedName: string;
  payload: PresetFile;
}

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

export interface OpenPresetFileRequest {
  presetType: PresetFileKind;
}

export type OpenPresetFileResponse =
  | {
      status: 'opened';
      filePath: string;
      payload: PresetFile;
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
