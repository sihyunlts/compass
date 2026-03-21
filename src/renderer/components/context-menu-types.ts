import type { PresetFileKind } from '../../shared/presets';

export type ContextMenuTarget =
  | {
      kind: 'devices';
      deviceIds: readonly string[];
      canGroup: boolean;
    }
  | {
      kind: 'group';
      groupId: string;
      memberDeviceIds: readonly string[];
    }
  | {
      kind: 'preset-entry';
      presetType: PresetFileKind;
      relativePath: readonly string[];
      entryKind: 'file' | 'directory';
    }
  | {
      kind: 'presets-root';
    };
