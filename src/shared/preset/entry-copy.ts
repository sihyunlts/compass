import {
  isDeviceBrowserSystemDirectoryPath,
  resolveDeviceBrowserSystemDirectoryPath,
} from '../../devices/browser-categories';
import { PRESET_FILE_EXTENSIONS } from './file';
import {
  getPresetPathCollisionKey,
  isPresetPathInsideIgnoringCase,
  normalizePresetEntrySelection,
  type PresetEntryPath,
  type PresetEntrySelectionItem,
} from './entry-selection';

export interface PresetEntryCopyPlan {
  entry: PresetEntrySelectionItem;
  relativePath: string[];
}

export const preparePresetEntryCopy = (
  entries: readonly PresetEntrySelectionItem[],
  destination: PresetEntryPath | undefined,
  occupiedPaths: readonly PresetEntryPath[],
): { status: 'ok'; plans: PresetEntryCopyPlan[] } | { status: 'error'; message: string } => {
  const selectedEntries = normalizePresetEntrySelection(entries);
  const presetType = selectedEntries[0]?.presetType;
  if (
    !presetType
    || selectedEntries.some((entry) =>
      entry.presetType !== presetType
      || entry.relativePath.length === 0
      || (entry.entryKind === 'directory'
        && presetType === 'device'
        && isDeviceBrowserSystemDirectoryPath(entry.relativePath)))
    || (destination && destination.presetType !== presetType)
  ) {
    return { status: 'error', message: 'Preset items cannot be copied to that folder.' };
  }

  const occupiedKeys = new Set(occupiedPaths
    .filter((path) => path.presetType === presetType)
    .map((path) => getPresetPathCollisionKey(path.relativePath)));
  const plans: PresetEntryCopyPlan[] = [];
  for (const entry of selectedEntries) {
    const parentRelativePath = destination
      ? presetType === 'device'
        ? resolveDeviceBrowserSystemDirectoryPath(destination.relativePath)
          ?? [...destination.relativePath]
        : [...destination.relativePath]
      : entry.relativePath.slice(0, -1);
    if (
      entry.entryKind === 'directory'
      && isPresetPathInsideIgnoringCase(entry.relativePath, parentRelativePath)
    ) {
      return {
        status: 'error',
        message: 'A folder cannot be copied into itself or one of its subfolders.',
      };
    }

    const sourceName = entry.relativePath[entry.relativePath.length - 1];
    const extension = entry.entryKind === 'file'
      ? PRESET_FILE_EXTENSIONS[presetType]
      : '';
    if (extension && !sourceName.toLocaleLowerCase('en-US').endsWith(extension)) {
      return { status: 'error', message: 'Invalid file type.' };
    }
    const stem = sourceName.slice(0, sourceName.length - extension.length);
    let targetName = sourceName;
    let relativePath = [...parentRelativePath, targetName];
    for (let copyNumber = 2; occupiedKeys.has(getPresetPathCollisionKey(relativePath)); copyNumber += 1) {
      targetName = `${stem} ${copyNumber}${extension}`;
      relativePath = [...parentRelativePath, targetName];
    }
    if (
      entry.entryKind === 'directory'
      && presetType === 'device'
      && isDeviceBrowserSystemDirectoryPath(relativePath)
    ) {
      return { status: 'error', message: 'Built-in device folder names are reserved.' };
    }
    occupiedKeys.add(getPresetPathCollisionKey(relativePath));
    plans.push({ entry, relativePath });
  }

  return { status: 'ok', plans };
};
