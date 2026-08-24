import type { PresetFileErrorCode } from '../../../shared/presets';
import type { MessageKey } from '../../../shared/i18n';
import { i18n } from '../../i18n.svelte';

const PRESET_FILE_ERROR_MESSAGE_KEYS = {
  'extension-payload-mismatch': 'preset.error.extensionMismatch',
  'file-read-failed': 'preset.error.readFailed',
  'invalid-file-format': 'preset.error.invalidFormat',
  'invalid-file-path': 'preset.error.invalidPath',
  'invalid-read-request': 'preset.error.invalidRequest',
  'preset-not-found': 'preset.error.notFound',
  'preset-type-mismatch': 'preset.error.typeMismatch',
  'unsupported-file-extension': 'preset.error.unsupportedExtension',
} as const satisfies Readonly<Record<PresetFileErrorCode, MessageKey>>;

export const resolvePresetFileErrorMessage = (
  errorCode: PresetFileErrorCode,
): string => i18n.t(PRESET_FILE_ERROR_MESSAGE_KEYS[errorCode]);
