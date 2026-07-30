import type { PresetFileKind } from '../../../shared/presets';

export interface PresetEntryContextTarget {
  kind: 'preset-entry';
  presetType: PresetFileKind;
  relativePath: readonly string[];
  entryKind: 'file' | 'directory';
  isSystemFolder?: boolean;
}

export interface PresetEntriesContextTarget {
  kind: 'preset-entries';
  entries: readonly PresetEntryContextTarget[];
}

export type PresetBrowserContextTarget =
  | PresetEntryContextTarget
  | PresetEntriesContextTarget;

export type PresetDeleteContextTarget =
  | PresetEntryContextTarget
  | PresetEntriesContextTarget;

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
  | PresetBrowserContextTarget;

export const isPresetBrowserContextTarget = (
  target: ContextMenuTarget | null | undefined,
): target is PresetBrowserContextTarget =>
  target?.kind === 'preset-entry'
  || target?.kind === 'preset-entries';

export const isPresetDeleteContextTarget = (
  target: ContextMenuTarget,
): target is PresetDeleteContextTarget =>
  target.kind === 'preset-entry' || target.kind === 'preset-entries';
