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

export interface PresetBrowserFileItem<K extends PresetFileKind = PresetFileKind> {
  presetType: K;
  name: string;
  relativePath: string[];
}

export interface PresetBrowserSection {
  id: string;
  title: string;
  entries: PresetBrowserFileItem[];
}

export type ListPresetBrowserSectionsResponse =
  | {
      status: 'ok';
      sections: PresetBrowserSection[];
    }
  | {
      status: 'error';
      message: string;
    };

export interface ReadPresetEntryRequest<K extends PresetFileKind = PresetFileKind> {
  presetType: K;
  relativePath: string[];
}

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
