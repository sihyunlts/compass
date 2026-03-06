import { sanitizePreviewBpm } from '../../services/storage';
import type { GroupSelectionContext } from '../rack/selection.svelte';
import { resolveExistingOrderedDeviceIds } from '../../state/chain';
import type { ContextMenuTarget } from '../../state/context-menu';
import type { GeneratorChain } from '../../../shared/model';

export type RackSelectionSnapshot =
  | {
      kind: 'devices';
      deviceIds: string[];
    }
  | {
      kind: 'group';
      groupId: string;
      memberDeviceIds: string[];
    };

type SelectionLike =
  | {
      kind: 'devices';
      deviceIds: readonly string[];
    }
  | {
      kind: 'group';
      groupId: string;
      memberDeviceIds: readonly string[];
    };

export const selectPreviewBpmText = (previewBpm: number): string =>
  `BPM ${sanitizePreviewBpm(previewBpm).toFixed(2)}`;

export const selectHistoryControls = (state: {
  canUndo: boolean;
  canRedo: boolean;
  undoActionLabel: string;
  redoActionLabel: string;
}) => ({
  canUndo: state.canUndo,
  canRedo: state.canRedo,
  undoActionLabel: state.undoActionLabel,
  redoActionLabel: state.redoActionLabel,
});

export const selectPreviewPanelControls = (state: {
  previewPlayLabel: string;
  isPreviewLoopEnabled: boolean;
  previewScrubValue: number;
}) => ({
  playLabel: state.previewPlayLabel,
  loopEnabled: state.isPreviewLoopEnabled,
  scrubValue: state.previewScrubValue,
});

export const selectClipboardAvailable = (state: {
  clipboardAvailable: boolean;
}): boolean => state.clipboardAvailable;

const toSelectionSnapshot = (
  chain: GeneratorChain,
  source: SelectionLike,
): RackSelectionSnapshot | null => {
  if (source.kind === 'group') {
    const memberDeviceIds = resolveExistingOrderedDeviceIds(
      chain.devices,
      source.memberDeviceIds,
    );
    if (memberDeviceIds.length === 0) {
      return null;
    }
    return {
      kind: 'group',
      groupId: source.groupId,
      memberDeviceIds,
    };
  }

  const deviceIds = resolveExistingOrderedDeviceIds(chain.devices, source.deviceIds);
  if (deviceIds.length === 0) {
    return null;
  }
  return {
    kind: 'devices',
    deviceIds,
  };
};

export const resolveCurrentSelectionSnapshot = (
  chain: GeneratorChain,
  selectedGroups: readonly GroupSelectionContext[],
  selectedDeviceIds: readonly string[],
): RackSelectionSnapshot | null => {
  const selectedGroup = selectedGroups[0] ?? null;
  if (selectedGroup && selectedGroups.length === 1) {
    return toSelectionSnapshot(chain, {
      kind: 'group',
      groupId: selectedGroup.groupId,
      memberDeviceIds: selectedGroup.memberDeviceIds,
    });
  }

  return toSelectionSnapshot(chain, {
    kind: 'devices',
    deviceIds: selectedDeviceIds,
  });
};

export const resolveSelectionSnapshotFromContextTarget = (
  chain: GeneratorChain,
  target: ContextMenuTarget,
): RackSelectionSnapshot | null =>
  target.kind === 'group'
    ? toSelectionSnapshot(chain, {
        kind: 'group',
        groupId: target.groupId,
        memberDeviceIds: target.memberDeviceIds,
      })
    : toSelectionSnapshot(chain, {
        kind: 'devices',
        deviceIds: target.deviceIds,
      });

export const resolveDeleteSelectionDeviceIds = (
  chain: GeneratorChain,
  selectedGroups: readonly GroupSelectionContext[],
  selectedDeviceIds: readonly string[],
): string[] => {
  const deleteIdSet = new Set(selectedDeviceIds);
  for (const selectedGroup of selectedGroups) {
    for (const memberId of selectedGroup.memberDeviceIds) {
      deleteIdSet.add(memberId);
    }
  }

  return resolveExistingOrderedDeviceIds(chain.devices, [...deleteIdSet]);
};
