import type { PresetOperationErrorCode } from '../../../shared/preset/operation-error';
import type { MessageKey } from '../../../shared/i18n';
import { i18n } from '../../i18n.svelte';

type PresetConflictContext = 'general' | 'name-edit' | 'move' | 'copy';

const CONFLICT_MESSAGE_KEYS = {
  general: 'preset.error.nameConflict',
  'name-edit': 'preset.error.nameConflictEdit',
  move: 'preset.error.nameConflictMove',
  copy: 'preset.error.nameConflictCopy',
} as const satisfies Record<PresetConflictContext, MessageKey>;

export const resolvePresetOperationErrorMessage = (
  errorCode: PresetOperationErrorCode | undefined,
  fallback: MessageKey,
  context: PresetConflictContext = 'general',
): string => i18n.t(errorCode === 'name-conflict' ? CONFLICT_MESSAGE_KEYS[context] : fallback);
