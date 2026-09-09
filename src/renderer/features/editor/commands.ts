import type { RendererDeviceKind } from '../../../devices';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import type { GeneratorChain, GeneratorDeviceNode, GroupMode } from '../../../shared/model';
import { sanitizeGeneratorChain } from '../../../shared/model/chain-normalization';
import { resolveGroupMode } from '../../../shared/group-state';
import type { RackInteractionCommit } from '../rack/types';
import {
  createRackClipboard,
  prepareClipboardInsert,
  type RackClipboard,
  type RackClipboardGroupState,
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
  applyInsertDevicesPreservingGroupsByDropZone,
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
  groupToggleIsolate: { kind: 'group-toggle-isolate' },
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
  const selectedLastItem = selection?.items.at(-1) ?? null;
  if (clipboardKind !== 'devices') {
    if (selectedLastItem?.kind === 'group') {
      return {
        kind: 'outside',
        targetId: resolveTailDeviceIdByGroup(chain.devices, selectedLastItem.groupId),
        placement: 'after',
      };
    }

    if (selectedLastItem?.kind === 'device') {
      return {
        kind: 'outside',
        targetId: coerceOutsideTargetIdToGroupBoundaryByDevices(
          chain.devices,
          selectedLastItem.deviceId,
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

  const selectedOnlyItem = selection?.items.length === 1 ? selection.items[0] : null;
  if (selectedOnlyItem?.kind === 'group') {
    const groupTailId = resolveTailDeviceIdByGroup(chain.devices, selectedOnlyItem.groupId);
    if (groupTailId) {
      return {
        kind: 'inside-group',
        groupId: selectedOnlyItem.groupId,
        targetId: groupTailId,
        placement: 'after',
      };
    }
  } else if (selection) {
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
  if (clipboardKind === 'devices' || dropZone.kind === 'outside') {
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
  collapsedDeviceIds: readonly string[] = [],
): RackClipboard | null => {
  const selectedOnlyItem = selection.items.length === 1 ? selection.items[0] : null;
  if (selectedOnlyItem?.kind === 'group') {
    const sourceDevices = resolveDevicesByIds(chain.devices, selectedOnlyItem.memberDeviceIds);
    return createRackClipboard(
      sourceDevices,
      {
        kind: 'group',
        enabled: chain.groupStateById[selectedOnlyItem.groupId]?.enabled !== false,
        mode: resolveGroupMode(chain.groupStateById, selectedOnlyItem.groupId),
        name: chain.groupStateById[selectedOnlyItem.groupId]?.name ?? null,
        metadata: chain.groupStateById[selectedOnlyItem.groupId]?.metadata,
      },
      collapsedDeviceIds,
    );
  }

  if (selection.items.every((item) => item.kind === 'device')) {
    return createRackClipboard(
      resolveDevicesByIds(chain.devices, selection.deviceIds),
      { kind: 'devices' },
      collapsedDeviceIds,
    );
  }

  const groupStateById: Record<string, RackClipboardGroupState> = {};
  for (const item of selection.items) {
    if (item.kind === 'group') {
      groupStateById[item.groupId] = {
        enabled: chain.groupStateById[item.groupId]?.enabled !== false,
        mode: resolveGroupMode(chain.groupStateById, item.groupId),
        name: chain.groupStateById[item.groupId]?.name ?? null,
        metadata: chain.groupStateById[item.groupId]?.metadata,
      };
    }
  }
  return createRackClipboard(
    resolveDevicesByIds(chain.devices, selection.deviceIds),
    { kind: 'rack-items', groupStateById },
    collapsedDeviceIds,
  );
};

export const buildChainWithClipboardPaste = (
  chain: GeneratorChain,
  clipboard: RackClipboard,
  selection: RackSelectionSnapshot | null,
): { chain: GeneratorChain; idMap: ReadonlyMap<string, string> } => {
  const rawDropZone = resolvePasteDropZone(chain, selection, clipboard.kind);
  const dropZone = coercePasteDropZone(chain, rawDropZone, clipboard.kind);
  const usedGroupIds = new Set(
    chain.devices.flatMap((device) => {
      const groupId = normalizeOptionalId(device.groupId);
      return groupId ? [groupId] : [];
    }),
  );
  const allocateGroupId = (): string => {
    let index = 1;
    while (usedGroupIds.has(`group-${index}`)) {
      index += 1;
    }
    const groupId = `group-${index}`;
    usedGroupIds.add(groupId);
    return groupId;
  };
  const prepared = prepareClipboardInsert(clipboard, {
    allocateDeviceId,
    resolveNextGroupId: () => resolveNextGroupId(chain.devices),
    allocateGroupId,
  });

  const forcedGroupId = prepared.groupStatePatches.length > 0
    ? prepared.forcedGroupId
    : dropZone.kind === 'inside-group'
      ? dropZone.groupId
      : null;
  const nextDevices = prepared.preservePreparedGroupIds
    ? applyInsertDevicesPreservingGroupsByDropZone(
        chain.devices,
        prepared.devices,
        dropZone,
      )
    : applyInsertDevicesByDropZone(
        chain.devices,
        prepared.devices,
        dropZone,
        forcedGroupId,
      );

  const nextChain = withDevices(chain, nextDevices);
  for (const patch of prepared.groupStatePatches) {
    nextChain.groupStateById[patch.groupId] = {
      enabled: patch.enabled,
      mode: patch.mode,
      name: patch.name,
      ...(patch.metadata
        ? { metadata: patch.metadata }
        : {}),
    };
  }
  return { chain: nextChain, idMap: prepared.idMap };
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
  const current = reconciledById[groupId];
  if (!current) {
    return null;
  }

  return {
    ...chain,
    groupStateById: {
      ...reconciledById,
      [groupId]: {
        ...current,
        enabled: nextEnabled,
      },
    },
  };
};

export const applyGroupModeChange = (
  chain: GeneratorChain,
  rawGroupId: string,
  nextMode: GroupMode,
): GeneratorChain | null => {
  const groupId = normalizeOptionalId(rawGroupId);
  if (
    !groupId
    || !chain.devices.some((device) => normalizeOptionalId(device.groupId) === groupId)
  ) {
    return null;
  }

  const reconciledById = reconcileGroupStateById(
    chain.groupStateById,
    chain.devices,
  );
  const current = reconciledById[groupId];
  if (!current || current.mode === nextMode) {
    return null;
  }

  return sanitizeGeneratorChain({
    ...chain,
    groupStateById: {
      ...reconciledById,
      [groupId]: {
        ...current,
        mode: nextMode,
      },
    },
  });
};

export const toggleRackSelectionEnabled = (
  chain: GeneratorChain,
  selection: RackSelectionSnapshot,
): GeneratorChain | null => {
  const selectedDeviceIds = new Set(
    selection.items.flatMap((item) => item.kind === 'device' ? [item.deviceId] : []),
  );
  const selectedGroupIds = new Set(
    selection.items.flatMap((item) => item.kind === 'group' ? [item.groupId] : []),
  );
  if (selectedDeviceIds.size === 0 && selectedGroupIds.size === 0) {
    return null;
  }

  const areAllSelectedItemsDisabled = selection.items.every((item) =>
    item.kind === 'group'
      ? chain.groupStateById[item.groupId]?.enabled === false
      : chain.devices.find((device) => device.id === item.deviceId)?.enabled === false);
  const nextEnabled = areAllSelectedItemsDisabled;
  const nextDevices = chain.devices.map((device) =>
    selectedDeviceIds.has(device.id) && device.enabled !== nextEnabled
      ? { ...device, enabled: nextEnabled }
      : device);
  const nextGroupStateById = reconcileGroupStateById(chain.groupStateById, nextDevices);
  for (const groupId of selectedGroupIds) {
    const groupState = nextGroupStateById[groupId];
    if (groupState) {
      nextGroupStateById[groupId] = { ...groupState, enabled: nextEnabled };
    }
  }

  return {
    ...chain,
    devices: nextDevices,
    groupStateById: nextGroupStateById,
  };
};
