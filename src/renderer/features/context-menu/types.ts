import type { PresetEntrySelectionItem } from '../../../shared/preset-entry-selection';
import type { PresetEntrySource } from '../../../shared/presets';

export interface PresetEntryContextTarget extends PresetEntrySelectionItem {
  kind: 'preset-entry';
  source: PresetEntrySource;
  isSystemFolder?: boolean;
  canShowInfo?: boolean;
}

interface PresetEntriesContextTarget {
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
      kind: 'modulation-parameter';
      deviceId: string;
      paramKey: string;
      connections: readonly {
        modulatorId: string;
        modulatorLabel: string;
        targetId: string;
      }[];
    }
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

export type ModulationParameterContextTarget = Extract<
  ContextMenuTarget,
  { kind: 'modulation-parameter' }
>;

type RackSelectionContextTarget = Extract<
  ContextMenuTarget,
  { kind: 'devices' | 'group' }
>;

export const isRackSelectionContextTarget = (
  target: ContextMenuTarget | null | undefined,
): target is RackSelectionContextTarget =>
  target?.kind === 'devices' || target?.kind === 'group';

export const isPresetBrowserContextTarget = (
  target: ContextMenuTarget | null | undefined,
): target is PresetBrowserContextTarget =>
  target?.kind === 'preset-entry'
  || target?.kind === 'preset-entries';

export const isPresetDeleteContextTarget = (
  target: ContextMenuTarget,
): target is PresetDeleteContextTarget =>
  target.kind === 'preset-entry' || target.kind === 'preset-entries';

export const canRenamePresetContextTarget = (
  target: PresetBrowserContextTarget,
): target is PresetEntryContextTarget =>
  target.kind === 'preset-entry'
  && target.relativePath.length > 0
  && target.source === 'user'
  && !target.isSystemFolder;

export const canDeletePresetContextTarget = (
  target: PresetBrowserContextTarget,
): boolean => target.kind === 'preset-entry'
  ? target.relativePath.length > 0
    && target.source === 'user'
    && !target.isSystemFolder
  : target.entries.length > 0
    && target.entries.every(
      (entry) =>
        entry.relativePath.length > 0
        && entry.source === 'user'
        && !entry.isSystemFolder,
    );
