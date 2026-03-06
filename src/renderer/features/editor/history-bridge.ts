import type { GeneratorChain } from '../../../shared/model';
import type { ChainMutationMeta } from '../../state/chain-history';
import type { EditorHistory, EditorHistoryListEntry } from './editor-history';
import type { EditorSessionState } from './session.svelte';

export const syncHistoryState = (
  state: EditorSessionState,
  history: EditorHistory,
): void => {
  state.canUndo = history.canUndo();
  state.canRedo = history.canRedo();
  state.undoActionLabel = history.getUndoEntry()?.label ?? 'Undo';
  state.redoActionLabel = history.getRedoEntry()?.label ?? 'Redo';
};

export const initializeHistoryBridge = (
  state: EditorSessionState,
  history: EditorHistory,
  options: {
    reconcileCurrentChainModulators: () => boolean;
    bumpChainRevision: () => void;
    requestSyncAfterRender: () => void;
  },
): void => {
  if (options.reconcileCurrentChainModulators()) {
    options.bumpChainRevision();
  }
  history.replaceCurrent(state.chainState);
  syncHistoryState(state, history);
  options.requestSyncAfterRender();
};

export const saveChainWithHistory = (
  state: EditorSessionState,
  history: EditorHistory,
  chain: GeneratorChain,
  meta: ChainMutationMeta,
  options: {
    bumpChainRevision: () => void;
    persistChainState: () => void;
  },
): void => {
  state.chainState = chain;
  options.bumpChainRevision();
  options.persistChainState();
  history.push(chain, meta);
  syncHistoryState(state, history);
};

export const applyChainMutation = (
  state: EditorSessionState,
  history: EditorHistory,
  nextChain: GeneratorChain,
  meta: ChainMutationMeta,
  options: {
    bumpChainRevision: () => void;
    persistChainState: () => void;
    scheduleAutoPreview: (delayMs?: number) => void;
  },
): void => {
  state.chainState = nextChain;
  options.persistChainState();
  options.bumpChainRevision();
  history.push(state.chainState, meta);
  syncHistoryState(state, history);
  options.scheduleAutoPreview(0);
};

const restoreChainFromHistory = (
  state: EditorSessionState,
  history: EditorHistory,
  chain: GeneratorChain,
  options: {
    bumpChainRevision: () => void;
    persistChainState: () => void;
    scheduleAutoPreview: (delayMs?: number) => void;
  },
): void => {
  state.chainState = chain;
  options.persistChainState();
  options.bumpChainRevision();
  history.replaceCurrent(state.chainState);
  syncHistoryState(state, history);
  options.scheduleAutoPreview(0);
};

export const undoHistory = (
  state: EditorSessionState,
  history: EditorHistory,
  options: {
    bumpChainRevision: () => void;
    persistChainState: () => void;
    scheduleAutoPreview: (delayMs?: number) => void;
  },
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
  options: {
    bumpChainRevision: () => void;
    persistChainState: () => void;
    scheduleAutoPreview: (delayMs?: number) => void;
  },
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
  options: {
    bumpChainRevision: () => void;
    persistChainState: () => void;
    scheduleAutoPreview: (delayMs?: number) => void;
  },
): boolean => {
  const restored = history.checkout(target);
  syncHistoryState(state, history);
  if (!restored) {
    return false;
  }

  restoreChainFromHistory(state, history, restored, options);
  return true;
};

export const getCurrentHistoryEntry = (
  history: EditorHistory,
): EditorHistoryListEntry | null =>
  history.list().find((entry) => entry.isCurrent) ?? null;
