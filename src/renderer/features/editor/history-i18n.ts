import { i18n } from '../../i18n.svelte';
import type { ChainHistoryKind } from './history-core';

type HistoryMessageKey = `history.action.${ChainHistoryKind}`;

export const resolveHistoryActionLabel = (
  kind: ChainHistoryKind,
): string => i18n.t(`history.action.${kind}` as HistoryMessageKey);
