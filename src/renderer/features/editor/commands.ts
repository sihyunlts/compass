import { normalizeOptionalId } from '../../../shared/normalize-id';
import type { GeneratorChain, GeneratorDeviceNode } from '../../../shared/model';
import type { RackInteractionCommit } from '../../components/device-rack-types';
import {
  createDeviceNodeByKind,
  type BrowserDeviceKind,
} from '../../services/devices';
import {
  createRackClipboard,
  prepareClipboardInsert,
  type RackClipboard,
} from '../../services/rack-clipboard';
import {
  reconcileGroupStateById,
  resolveCommonGroupId,
  resolveDevicesByIds,
  resolveNextGroupId,
  resolveTailDeviceIdByGroup,
  withDevices,
} from '../../state/chain';
import type { ChainMutationMeta } from '../../state/chain-history';
import {
  applyInsertDeviceByDropZone,
  applyInsertDevicesByDropZone,
  applyMoveDevicesByDropZone,
  coerceOutsideTargetIdToGroupBoundaryByDevices,
  type RackDropZone,
} from '../../state/rack-drop';
import type { RackSelectionSnapshot } from './selectors';

export const EDITOR_HISTORY_META = {
  addDevice: { kind: 'add-device', label: 'Add device' },
  insertDevice: { kind: 'insert-device', label: 'Insert device' },
  moveDevices: { kind: 'move-devices', label: 'Move devices' },
  deleteDevices: { kind: 'delete-devices', label: 'Delete devices' },
  groupCreate: { kind: 'group-create', label: 'Create group' },
  groupUngroup: { kind: 'group-ungroup', label: 'Ungroup devices' },
  groupToggleEnabled: { kind: 'group-toggle-enabled', label: 'Toggle group enabled' },
  clipboardCut: { kind: 'clipboard-cut', label: 'Cut selection' },
  clipboardPaste: { kind: 'clipboard-paste', label: 'Paste selection' },
  duplicate: { kind: 'duplicate', label: 'Duplicate selection' },
} as const satisfies Record<string, ChainMutationMeta>;

const allocateDeviceId = (kind: GeneratorDeviceNode['kind']): string =>
  createDeviceNodeByKind(kind).id;

const resolvePasteDropZone = (
  chain: GeneratorChain,
  selection: RackSelectionSnapshot | null,
  clipboardKind: RackClipboard['kind'],
): RackDropZone => {
  if (clipboardKind === 'group') {
    if (selection?.kind === 'group') {
      return {
        kind: 'outside',
        targetId: resolveTailDeviceIdByGroup(chain.devices, selection.groupId),
        placement: 'after',
      };
    }

    if (selection?.kind === 'devices') {
      const selectedLastId = selection.deviceIds[selection.deviceIds.length - 1] ?? null;
      return {
        kind: 'outside',
        targetId: coerceOutsideTargetIdToGroupBoundaryByDevices(
          chain.devices,
          selectedLastId,
          'after',
        ),
        placement: 'after',
      };
    }

    return {
      kind: 'outside',
      targetId: null,
      placement: 'after',
    };
  }

  if (selection?.kind === 'group') {
    const groupTailId = resolveTailDeviceIdByGroup(chain.devices, selection.groupId);
    if (groupTailId) {
      return {
        kind: 'inside-group',
        groupId: selection.groupId,
        targetId: groupTailId,
        placement: 'after',
      };
    }
  } else if (selection?.kind === 'devices') {
    const selectedLastId = selection.deviceIds[selection.deviceIds.length - 1] ?? null;
    if (selectedLastId) {
      const commonGroupId = resolveCommonGroupId(chain.devices, selection.deviceIds);
      if (commonGroupId) {
        return {
          kind: 'inside-group',
          groupId: commonGroupId,
          targetId: selectedLastId,
          placement: 'after',
        };
      }

      return {
        kind: 'outside',
        targetId: coerceOutsideTargetIdToGroupBoundaryByDevices(
          chain.devices,
          selectedLastId,
          'after',
        ),
        placement: 'after',
      };
    }
  }

  return {
    kind: 'outside',
    targetId: null,
    placement: 'after',
  };
};

const coercePasteDropZone = (
  chain: GeneratorChain,
  dropZone: RackDropZone,
  clipboardKind: RackClipboard['kind'],
): RackDropZone => {
  if (clipboardKind !== 'group' || dropZone.kind === 'outside') {
    return dropZone;
  }

  return {
    kind: 'outside',
    targetId: coerceOutsideTargetIdToGroupBoundaryByDevices(
      chain.devices,
      dropZone.targetId,
      dropZone.placement,
    ),
    placement: dropZone.placement,
  };
};

export const applyBrowserDeviceAdd = (
  chain: GeneratorChain,
  kind: BrowserDeviceKind,
): GeneratorChain => withDevices(
  chain,
  applyInsertDeviceByDropZone(
    chain.devices,
    createDeviceNodeByKind(kind),
    {
      kind: 'outside',
      targetId: null,
      placement: 'after',
    },
  ),
);

export const applyRackCommit = (
  chain: GeneratorChain,
  commit: RackInteractionCommit,
): GeneratorChain | null => {
  if (commit.kind === 'move') {
    const nextDevices = applyMoveDevicesByDropZone(
      chain.devices,
      commit.sourceIds,
      commit.dropZone,
      commit.sourceKind,
    );
    return nextDevices ? withDevices(chain, nextDevices) : null;
  }

  return withDevices(
    chain,
    applyInsertDeviceByDropZone(
      chain.devices,
      createDeviceNodeByKind(commit.sourceKind),
      commit.dropZone,
    ),
  );
};

export const buildClipboardFromSelection = (
  chain: GeneratorChain,
  selection: RackSelectionSnapshot,
): RackClipboard | null => {
  const sourceIds = selection.kind === 'group'
    ? selection.memberDeviceIds
    : selection.deviceIds;
  const sourceDevices = resolveDevicesByIds(chain.devices, sourceIds);

  if (selection.kind === 'group') {
    return createRackClipboard(sourceDevices, {
      kind: 'group',
      enabled: chain.groupStateById[selection.groupId]?.enabled !== false,
    });
  }

  return createRackClipboard(sourceDevices, { kind: 'devices' });
};

export const buildChainWithClipboardPaste = (
  chain: GeneratorChain,
  clipboard: RackClipboard,
  selection: RackSelectionSnapshot | null,
): GeneratorChain => {
  const rawDropZone = resolvePasteDropZone(chain, selection, clipboard.kind);
  const dropZone = coercePasteDropZone(chain, rawDropZone, clipboard.kind);
  const prepared = prepareClipboardInsert(clipboard, {
    allocateDeviceId,
    resolveNextGroupId: () => resolveNextGroupId(chain.devices),
  });

  const forcedGroupId = prepared.groupStatePatch
    ? prepared.forcedGroupId
    : dropZone.kind === 'inside-group'
      ? dropZone.groupId
      : null;
  const nextDevices = applyInsertDevicesByDropZone(
    chain.devices,
    prepared.devices,
    dropZone,
    forcedGroupId,
  );

  const nextChain = withDevices(chain, nextDevices);
  if (prepared.groupStatePatch) {
    nextChain.groupStateById[prepared.groupStatePatch.groupId] = {
      enabled: prepared.groupStatePatch.enabled,
    };
  }
  return nextChain;
};

export const applyGroupEnabledChange = (
  chain: GeneratorChain,
  rawGroupId: string,
  nextEnabled: boolean,
): GeneratorChain | null => {
  const groupId = normalizeOptionalId(rawGroupId);
  if (!groupId) {
    return null;
  }

  const hasGroup = chain.devices.some(
    (device) => normalizeOptionalId(device.groupId) === groupId,
  );
  if (!hasGroup) {
    return null;
  }

  const currentEnabled = chain.groupStateById[groupId]?.enabled !== false;
  if (currentEnabled === nextEnabled) {
    return null;
  }

  const reconciledById = reconcileGroupStateById(
    chain.groupStateById,
    chain.devices,
  );

  return {
    ...chain,
    groupStateById: {
      ...reconciledById,
      [groupId]: {
        enabled: nextEnabled,
      },
    },
  };
};
