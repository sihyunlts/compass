import { buildDeviceNameSnapshotsById, buildGroupNameSnapshotsById } from '../rack/display-names';
import { getDeviceMessageKey } from '../../device-i18n';
import { i18n } from '../../i18n.svelte';
import type { GeneratorChain } from '../../../shared/model';
import { sanitizeGeneratorChain } from '../../../shared/model/chain-normalization';
import type { ChainMutationMeta } from './history-core';
import type { EditorHistory } from './editor-history';
import type { EditorSessionState } from './session.svelte';

export const syncHistoryState = (
  state: EditorSessionState,
  history: EditorHistory,
): void => {
  const undoEntry = history.getUndoEntry();
  const redoEntry = history.getRedoEntry();
  state.canUndo = history.canUndo();
  state.canRedo = history.canRedo();
  state.undoAction = undoEntry ? {
    kind: undoEntry.kind,
    parameterLabelKey: undoEntry.parameterLabelKey,
    targets: undoEntry.targets,
  } : null;
  state.redoAction = redoEntry ? {
    kind: redoEntry.kind,
    parameterLabelKey: redoEntry.parameterLabelKey,
    targets: redoEntry.targets,
  } : null;
};

export const initializeHistoryBridge = (
  state: EditorSessionState,
  history: EditorHistory,
  options: {
    requestSyncAfterRender: () => void;
  },
): void => {
  state.chainState = sanitizeGeneratorChain(state.chainState);
  history.replaceCurrent(state.chainState);
  syncHistoryState(state, history);
  options.requestSyncAfterRender();
};

interface ChainCommitOptions {
  bumpChainRevision: () => void;
  persistChainState: () => void;
}

const replaceCommittedChain = (
  state: EditorSessionState,
  chain: GeneratorChain,
  options: ChainCommitOptions,
): GeneratorChain => {
  const normalizedChain = sanitizeGeneratorChain(chain);
  state.chainState = normalizedChain;
  options.bumpChainRevision();
  options.persistChainState();
  return normalizedChain;
};

const resolveMutationTargets = (
  previousChain: GeneratorChain,
  nextChain: GeneratorChain,
  meta: ChainMutationMeta,
) => {
  const isRemoval = meta.kind === 'delete-devices' || meta.kind === 'clipboard-cut' || meta.kind === 'group-ungroup';
  const sourceChain = isRemoval ? previousChain : nextChain;
  let deviceIds = meta.deviceIds ?? [];
  if (deviceIds.length === 0) {
    switch (meta.kind) {
      case 'add-device':
      case 'insert-device':
      case 'insert-devices':
      case 'insert-device-preset':
      case 'insert-group-preset':
      case 'clipboard-paste':
      case 'duplicate':
      case 'delete-devices':
      case 'clipboard-cut': {
        const otherIds = new Set(
          (isRemoval ? nextChain : previousChain).devices.map((device) => device.id),
        );
        deviceIds = sourceChain.devices
          .filter((device) => !otherIds.has(device.id))
          .map((device) => device.id);
        break;
      }
    }
  }
  const groupIds = new Set(meta.groupIds ?? []);
  const groupSnapshots = groupIds.size > 0
    ? buildGroupNameSnapshotsById(sourceChain, i18n.t('group.defaultTemplate'))
    : {};
  const groups = [...groupIds].map((id) => groupSnapshots[id]).filter((snapshot) => snapshot !== undefined);
  const groupedDeviceIds = new Set(sourceChain.devices
    .filter((device) => device.groupId && groupIds.has(device.groupId))
    .map((device) => device.id));
  deviceIds = deviceIds.filter((id) => !groupedDeviceIds.has(id));
  if (deviceIds.length === 0) return groups;

  const snapshotsById = buildDeviceNameSnapshotsById(
    sourceChain.devices,
    (kind) => i18n.t(getDeviceMessageKey(kind)),
  );
  return [...groups, ...[...new Set(deviceIds)].map((id) => snapshotsById[id]).filter((snapshot) => snapshot !== undefined)];
};

export const commitChainMutation = (
  state: EditorSessionState,
  history: EditorHistory,
  chain: GeneratorChain,
  meta: ChainMutationMeta,
  options: ChainCommitOptions,
): void => {
  const previousChain = state.chainState;
  const normalizedChain = replaceCommittedChain(state, chain, options);
  history.push(normalizedChain, {
    ...meta,
    targets: resolveMutationTargets(previousChain, normalizedChain, meta),
  });
  syncHistoryState(state, history);
};

export const resetChainHistory = (
  state: EditorSessionState,
  history: EditorHistory,
  nextChain: GeneratorChain,
  meta: ChainMutationMeta,
  options: ChainCommitOptions,
): void => {
  const normalizedChain = replaceCommittedChain(state, nextChain, options);
  history.reset(normalizedChain, meta);
  syncHistoryState(state, history);
};

const restoreChainFromHistory = (
  state: EditorSessionState,
  history: EditorHistory,
  chain: GeneratorChain,
  options: ChainCommitOptions,
): void => {
  const normalizedChain = replaceCommittedChain(state, chain, options);
  history.replaceCurrent(normalizedChain);
  syncHistoryState(state, history);
};

export const undoHistory = (
  state: EditorSessionState,
  history: EditorHistory,
  options: ChainCommitOptions,
): boolean => {
  const restored = history.undo();
  syncHistoryState(state, history);
  if (!restored) {
    return false;
  }

  restoreChainFromHistory(state, history, restored, options);
  return true;
};

export const redoHistory = (
  state: EditorSessionState,
  history: EditorHistory,
  options: ChainCommitOptions,
): boolean => {
  const restored = history.redo();
  syncHistoryState(state, history);
  if (!restored) {
    return false;
  }

  restoreChainFromHistory(state, history, restored, options);
  return true;
};

export const checkoutHistory = (
  state: EditorSessionState,
  history: EditorHistory,
  target: string | number,
  options: ChainCommitOptions,
): boolean => {
  const restored = history.checkout(target);
  syncHistoryState(state, history);
  if (!restored) {
    return false;
  }

  restoreChainFromHistory(state, history, restored, options);
  return true;
};
