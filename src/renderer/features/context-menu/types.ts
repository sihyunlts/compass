import type { PresetEntrySelectionItem } from '../../../shared/preset-entry-selection';

export interface PresetEntryContextTarget extends PresetEntrySelectionItem {
  kind: 'preset-entry';
  isSystemFolder?: boolean;
  canShowInfo?: boolean;
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

export type RackSelectionContextTarget = Extract<
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
