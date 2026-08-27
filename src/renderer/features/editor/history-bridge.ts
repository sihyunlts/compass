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
  state.undoActionKind = undoEntry?.kind ?? null;
  state.redoActionKind = redoEntry?.kind ?? null;
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

export const commitChainMutation = (
  state: EditorSessionState,
  history: EditorHistory,
  chain: GeneratorChain,
  meta: ChainMutationMeta,
  options: ChainCommitOptions,
): void => {
  const normalizedChain = replaceCommittedChain(state, chain, options);
  history.push(normalizedChain, meta);
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
