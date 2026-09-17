import type { PresetOperationErrorCode } from './operation-error';
import {
  arePresetPathsEqual,
  doPresetPathsCollide,
  getPresetPathCollisionKey,
  isPresetPathInsideIgnoringCase,
  normalizePresetEntrySelection,
  type PresetEntryPath,
  type PresetEntrySelectionItem,
} from './entry-selection';
import {
  isDeviceBrowserSystemDirectoryPath,
  resolveDeviceBrowserSystemDirectoryPath,
} from '../../devices/browser-categories';
import type { PresetFileKind } from './file';

export type PresetEntryMoveDestination = PresetEntryPath;

export interface PresetEntryMovePlan {
  entry: PresetEntrySelectionItem;
  relativePath: string[];
  isNoop: boolean;
}

type PresetEntryMoveError = {
  status: 'error';
  errorCode?: PresetOperationErrorCode;
  message: string;
};

type PresetEntryMovePlanResult =
  | {
      status: 'ok';
      plans: PresetEntryMovePlan[];
    }
  | PresetEntryMoveError;

interface PreparedPresetEntryMove {
  status: 'ok';
  presetType: PresetFileKind;
  destinationRelativePath: string[];
  createDestination: boolean;
  plans: PresetEntryMovePlan[];
}

const moveError = (message: string, errorCode?: PresetOperationErrorCode): PresetEntryMoveError => ({
  status: 'error',
  message,
  ...(errorCode ? { errorCode } : {}),
});

const planPresetEntryMove = (
  entries: readonly PresetEntrySelectionItem[],
  destination: PresetEntryMoveDestination,
): PresetEntryMovePlanResult => {
  const normalizedEntries = normalizePresetEntrySelection(entries);
  if (
    normalizedEntries.length === 0
    || normalizedEntries.some(
      (entry) =>
        entry.presetType !== destination.presetType
        || entry.relativePath.length === 0,
    )
  ) {
    return moveError(
      'Preset items can only be moved within the same browser page.',
    );
  }

  const plans: PresetEntryMovePlan[] = [];
  const targetKeys = new Set<string>();
  for (const entry of normalizedEntries) {
    if (
      entry.entryKind === 'directory'
      && isPresetPathInsideIgnoringCase(
        entry.relativePath,
        destination.relativePath,
      )
    ) {
      return moveError(
        'A folder cannot be moved into itself or one of its subfolders.',
      );
    }

    const entryName = entry.relativePath[entry.relativePath.length - 1];
    if (!entryName) {
      return moveError('Preset root folders cannot be moved.');
    }

    const relativePath = [...destination.relativePath, entryName];
    const targetKey = getPresetPathCollisionKey(relativePath);
    if (targetKeys.has(targetKey)) {
      return moveError(
        'Multiple selected items have the same name at the destination.',
      );
    }
    targetKeys.add(targetKey);
    plans.push({
      entry,
      relativePath,
      isNoop: arePresetPathsEqual(
        entry.relativePath.slice(0, -1),
        destination.relativePath,
      ),
    });
  }

  return {
    status: 'ok',
    plans,
  };
};

export const preparePresetEntryMove = (
  entries: readonly PresetEntrySelectionItem[],
  destination: PresetEntryMoveDestination,
  occupiedPaths: readonly PresetEntryPath[] = [],
): PreparedPresetEntryMove | PresetEntryMoveError => {
  const presetType = destination.presetType;
  const systemDestination = presetType === 'device'
    ? resolveDeviceBrowserSystemDirectoryPath(destination.relativePath)
    : null;
  const destinationRelativePath =
    systemDestination ?? [...destination.relativePath];
  const movePlan = planPresetEntryMove(entries, {
    presetType,
    relativePath: destinationRelativePath,
  });
  if (movePlan.status === 'error') {
    return movePlan;
  }
  if (presetType === 'device') {
    const systemFolderPlan = movePlan.plans.find(
      ({ entry, relativePath }) =>
        entry.entryKind === 'directory'
        && (
          isDeviceBrowserSystemDirectoryPath(entry.relativePath)
          || isDeviceBrowserSystemDirectoryPath(relativePath)
        ),
    );
    if (systemFolderPlan) {
      return moveError(
        isDeviceBrowserSystemDirectoryPath(
          systemFolderPlan.entry.relativePath,
        )
          ? 'Built-in device folders cannot be moved.'
          : 'Built-in device folder names are reserved.',
      );
    }
  }
  if (
    movePlan.plans.some(
      (plan) =>
        !plan.isNoop
        && occupiedPaths.some(
          (path) =>
            path.presetType === plan.entry.presetType
            && doPresetPathsCollide(path.relativePath, plan.relativePath),
        ),
    )
  ) {
    return moveError('An item or folder with that name already exists.', 'name-conflict');
  }

  return {
    status: 'ok',
    presetType,
    destinationRelativePath,
    createDestination: systemDestination !== null,
    plans: movePlan.plans,
  };
};

// Hover also opens folders so users can reach a non-conflicting subfolder.
// Name occupancy is checked when the move is actually submitted.
export const canHoverPresetMoveDestination = (
  entries: readonly PresetEntrySelectionItem[],
  destination: PresetEntryMoveDestination,
): boolean => {
  const result = preparePresetEntryMove(entries, destination);
  return result.status === 'ok'
    && result.plans.some((plan) => !plan.isNoop);
};
