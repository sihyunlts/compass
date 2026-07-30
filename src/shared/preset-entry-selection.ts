import type { PresetFileKind } from './presets';

export interface PresetEntryPath {
  presetType: PresetFileKind;
  relativePath: readonly string[];
}

export interface PresetEntrySelectionItem extends PresetEntryPath {
  entryKind: 'file' | 'directory';
}

export const getPresetPathCollisionKey = (
  relativePath: readonly string[],
): string => JSON.stringify(
  relativePath.map((segment) => segment.toLocaleLowerCase('en-US')),
);

export const arePresetPathsEqual = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length
  && left.every((segment, index) => segment === right[index]);

export const doPresetPathsCollide = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  getPresetPathCollisionKey(left) === getPresetPathCollisionKey(right);

export const isPresetPathInside = (
  parent: readonly string[],
  candidate: readonly string[],
): boolean =>
  parent.length <= candidate.length
  && arePresetPathsEqual(parent, candidate.slice(0, parent.length));

export const isPresetPathInsideIgnoringCase = (
  parent: readonly string[],
  candidate: readonly string[],
): boolean =>
  parent.length <= candidate.length
  && parent.every(
    (segment, index) =>
      segment.toLocaleLowerCase('en-US')
      === (candidate[index] ?? '').toLocaleLowerCase('en-US'),
  );

const hasSamePresetPath = (
  left: PresetEntryPath,
  right: PresetEntryPath,
): boolean =>
  left.presetType === right.presetType
  && arePresetPathsEqual(left.relativePath, right.relativePath);

const containsPresetEntry = (
  directory: PresetEntrySelectionItem,
  entry: PresetEntryPath,
): boolean =>
  directory.entryKind === 'directory'
  && directory.presetType === entry.presetType
  && directory.relativePath.length < entry.relativePath.length
  && isPresetPathInside(directory.relativePath, entry.relativePath);

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
