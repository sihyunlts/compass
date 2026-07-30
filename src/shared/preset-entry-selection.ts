import type { PresetFileKind } from './presets';

export interface PresetEntrySelectionItem {
  presetType: PresetFileKind;
  relativePath: readonly string[];
  entryKind: 'file' | 'directory';
}

const hasSamePresetPath = (
  left: PresetEntrySelectionItem,
  right: PresetEntrySelectionItem,
): boolean =>
  left.presetType === right.presetType
  && left.relativePath.length === right.relativePath.length
  && left.relativePath.every(
    (segment, index) => segment === right.relativePath[index],
  );

const containsPresetEntry = (
  directory: PresetEntrySelectionItem,
  entry: PresetEntrySelectionItem,
): boolean =>
  directory.entryKind === 'directory'
  && directory.presetType === entry.presetType
  && directory.relativePath.length < entry.relativePath.length
  && directory.relativePath.every(
    (segment, index) => segment === entry.relativePath[index],
  );

export const normalizePresetEntrySelection = <
  T extends PresetEntrySelectionItem,
>(
  entries: readonly T[],
): T[] =>
  entries
    .filter((entry, index) =>
      entries.findIndex((candidate) => hasSamePresetPath(candidate, entry)) === index)
    .filter((entry, _index, uniqueEntries) =>
      !uniqueEntries.some((candidate) => containsPresetEntry(candidate, entry)));
