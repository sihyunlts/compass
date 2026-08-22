import type { RendererDeviceKind } from '../../../devices';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import type { GeneratorChain, GeneratorDeviceNode } from '../../../shared/model';
import type { RackInteractionCommit } from '../rack/types';
import {
  createRackClipboard,
  prepareClipboardInsert,
  type RackClipboard,
} from './rack-clipboard';
import {
  reconcileGroupStateById,
  resolveCommonGroupId,
  resolveDevicesByIds,
  resolveNextGroupId,
  resolveTailDeviceIdByGroup,
  withDevices,
} from './chain-ops';
import { createDeviceNodeByKind } from './device-node-factory';
import {
  applyInsertDeviceByDropZone,
  applyInsertDevicesByDropZone,
  applyMoveDevicesByDropZone,
  coerceOutsideTargetIdToGroupBoundaryByDevices,
  type RackDropZone,
} from '../rack/drop-ops';
import type { ChainMutationMeta } from './history-core';
import type { RackSelectionSnapshot } from './selectors';

export const EDITOR_HISTORY_META = {
  addDevice: { kind: 'add-device' },
  insertDevice: { kind: 'insert-device' },
  insertDevices: { kind: 'insert-devices' },
  moveDevices: { kind: 'move-devices' },
  deleteDevices: { kind: 'delete-devices' },
  groupCreate: { kind: 'group-create' },
  groupUngroup: { kind: 'group-ungroup' },
  groupToggleEnabled: { kind: 'group-toggle-enabled' },
  renameDevice: { kind: 'rename-device' },
  renameGroup: { kind: 'rename-group' },
  editDeviceInfo: { kind: 'edit-device-info' },
  editGroupInfo: { kind: 'edit-group-info' },
  editRackInfo: { kind: 'edit-rack-info' },
  clipboardCut: { kind: 'clipboard-cut' },
  clipboardPaste: { kind: 'clipboard-paste' },
  duplicate: { kind: 'duplicate' },
  insertDevicePreset: { kind: 'insert-device-preset' },
  insertGroupPreset: { kind: 'insert-group-preset' },
  loadRackPreset: { kind: 'load-rack-preset' },
  deviceToggleEnabled: { kind: 'control-edit', finalize: true },
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
  kind: RendererDeviceKind,
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

  if (commit.kind === 'insert-device') {
    return withDevices(
      chain,
      applyInsertDeviceByDropZone(
        chain.devices,
        createDeviceNodeByKind(commit.deviceKind),
        commit.dropZone,
      ),
    );
  }

  return withDevices(
    chain,
    applyInsertDevicesByDropZone(
      chain.devices,
      commit.deviceKinds.map((kind) => createDeviceNodeByKind(kind)),
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
      name: chain.groupStateById[selection.groupId]?.name ?? null,
      metadata: chain.groupStateById[selection.groupId]?.metadata,
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
      name: prepared.groupStatePatch.name,
      ...(prepared.groupStatePatch.metadata
        ? { metadata: prepared.groupStatePatch.metadata }
        : {}),
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
        name: reconciledById[groupId]?.name ?? null,
        ...(reconciledById[groupId]?.metadata
          ? { metadata: reconciledById[groupId].metadata }
          : {}),
      },
    },
  };
};

export const toggleDevicesEnabled = (
  chain: GeneratorChain,
  deviceIds: readonly string[],
): GeneratorChain | null => {
  const targetIds = new Set(deviceIds);
  const targetDevices = chain.devices.filter((device) => targetIds.has(device.id));
  if (targetDevices.length === 0) {
    return null;
  }

  const nextEnabled = targetDevices.every((device) => device.enabled === false);
  return withDevices(
    chain,
    chain.devices.map((device) =>
      targetIds.has(device.id) && device.enabled !== nextEnabled
        ? { ...device, enabled: nextEnabled }
        : device),
  );
};
