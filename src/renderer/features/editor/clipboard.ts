import type { ContextMenuTarget } from '../../components/overlays/context-menu-types';
import type { ChainMutationMeta } from './history-core';
import type { RackClipboard } from './rack-clipboard';
import {
  EDITOR_HISTORY_META,
  buildChainWithClipboardPaste,
  buildClipboardFromSelection,
} from './commands';
import {
  resolveCurrentSelectionSnapshot,
  resolveSelectionSnapshotFromContextTarget,
  type RackSelectionSnapshot,
} from './selectors';
import type { EditorRackBinding, EditorSessionState } from './session.svelte';

interface ClipboardContext {
  state: EditorSessionState;
  rackBinding: EditorRackBinding | null;
  getClipboard: () => RackClipboard | null;
  setClipboard: (clipboard: RackClipboard | null) => void;
  applyChainMutation: (
    nextChain: EditorSessionState['chainState'],
    meta: ChainMutationMeta,
  ) => void;
  deleteDevicesById: (
    deviceIds: readonly string[],
    meta?: ChainMutationMeta,
  ) => boolean;
  deleteGroup: (
    rawGroupId: string,
    meta?: ChainMutationMeta,
  ) => boolean;
  applyInsertedSelection: (
    clipboard: RackClipboard,
    previousChain: EditorSessionState['chainState'],
    nextChain: EditorSessionState['chainState'],
  ) => void;
}

const getCurrentSelectionSnapshot = (
  state: EditorSessionState,
  rackBinding: EditorRackBinding | null,
): RackSelectionSnapshot | null => {
  if (!rackBinding) {
    return null;
  }

  return resolveCurrentSelectionSnapshot(
    state.chainState,
    rackBinding.getSelectedGroupContexts(),
    rackBinding.getOrderedSelectedDeviceIds(),
  );
};

const resolveActionSelection = (
  state: EditorSessionState,
  rackBinding: EditorRackBinding | null,
  selectionOverride?: RackSelectionSnapshot | null,
): RackSelectionSnapshot | null =>
  selectionOverride ?? getCurrentSelectionSnapshot(state, rackBinding);

export const resolveContextSelection = (
  state: EditorSessionState,
  target: ContextMenuTarget,
): RackSelectionSnapshot | null =>
  resolveSelectionSnapshotFromContextTarget(state.chainState, target);

export const copySelectionToClipboard = (
  context: ClipboardContext,
  selectionOverride?: RackSelectionSnapshot | null,
): RackClipboard | null => {
  const selection = resolveActionSelection(
    context.state,
    context.rackBinding,
    selectionOverride,
  );
  if (!selection) {
    return null;
  }

  const nextClipboard = buildClipboardFromSelection(
    context.state.chainState,
    selection,
  );
  if (!nextClipboard) {
    return null;
  }

  context.setClipboard(nextClipboard);
  return nextClipboard;
};

export const cutSelection = (
  context: ClipboardContext,
  selectionOverride?: RackSelectionSnapshot | null,
): boolean => {
  const selection = resolveActionSelection(
    context.state,
    context.rackBinding,
    selectionOverride,
  );
  if (!selection) {
    return false;
  }

  const copied = copySelectionToClipboard(context, selection);
  if (!copied) {
    return false;
  }

  return selection.kind === 'group'
    ? context.deleteGroup(selection.groupId, EDITOR_HISTORY_META.clipboardCut)
    : context.deleteDevicesById(selection.deviceIds, EDITOR_HISTORY_META.clipboardCut);
};

export const pasteClipboard = (
  context: ClipboardContext,
  clipboardOverride?: RackClipboard | null,
  selectionOverride?: RackSelectionSnapshot | null,
  meta: ChainMutationMeta = EDITOR_HISTORY_META.clipboardPaste,
): boolean => {
  const clipboard = clipboardOverride ?? context.getClipboard();
  if (!clipboard) {
    return false;
  }

  const selection = resolveActionSelection(
    context.state,
    context.rackBinding,
    selectionOverride,
  );
  const nextChain = buildChainWithClipboardPaste(
    context.state.chainState,
    clipboard,
    selection,
  );
  const previousChain = context.state.chainState;
  context.applyChainMutation(nextChain, meta);
  context.applyInsertedSelection(
    clipboard,
    previousChain,
    nextChain,
  );
  return true;
};

export const duplicateSelection = (
  context: ClipboardContext,
  selectionOverride?: RackSelectionSnapshot | null,
): boolean => {
  const selection = resolveActionSelection(
    context.state,
    context.rackBinding,
    selectionOverride,
  );
  if (!selection) {
    return false;
  }

  const copied = copySelectionToClipboard(context, selection);
  if (!copied) {
    return false;
  }

  return pasteClipboard(
    context,
    copied,
    selection,
    EDITOR_HISTORY_META.duplicate,
  );
};
