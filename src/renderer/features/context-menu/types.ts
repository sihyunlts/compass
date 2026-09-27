import type { PresetEntrySelectionItem } from '../../../shared/preset/entry-selection';
import type { PresetEntrySource } from '../../../shared/preset/file';

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

export const resolvePresetSelectionContextTarget = (
  clickedTarget: PresetEntryContextTarget,
  selectedTargets: readonly PresetEntryContextTarget[],
): PresetBrowserContextTarget => {
  if (clickedTarget.isSystemFolder) return clickedTarget;
  const editableTargets = selectedTargets.filter((target) => !target.isSystemFolder);
  return editableTargets.length > 1
    ? { kind: 'preset-entries', entries: editableTargets }
    : clickedTarget;
};

export type PresetDeleteContextTarget = PresetBrowserContextTarget;

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

const copyPresetEntryTarget = (target: PresetEntryContextTarget): PresetEntryContextTarget => ({
  ...target,
  relativePath: [...target.relativePath],
});

/** Keep the menu's selection stable while the editor or browser selection changes. */
export const snapshotContextMenuTarget = (target: ContextMenuTarget): ContextMenuTarget => {
  switch (target.kind) {
    case 'devices':
      return { ...target, deviceIds: [...target.deviceIds] };
    case 'group':
      return { ...target, memberDeviceIds: [...target.memberDeviceIds] };
    case 'modulation-parameter':
      return { ...target, connections: target.connections.map((connection) => ({ ...connection })) };
    case 'preset-entry':
      return copyPresetEntryTarget(target);
    case 'preset-entries':
      return { ...target, entries: target.entries.map(copyPresetEntryTarget) };
  }
};

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
  isPresetBrowserContextTarget(target);

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
  ? canRenamePresetContextTarget(target)
  : target.entries.length > 0
    && target.entries.every(canRenamePresetContextTarget);

export const canCopyPresetContextTarget = (
  target: PresetBrowserContextTarget,
): boolean => {
  const entries = target.kind === 'preset-entry' ? [target] : target.entries;
  return entries.length > 0
    && entries.every((entry) =>
      canRenamePresetContextTarget(entry)
      && entry.presetType === entries[0].presetType);
};
