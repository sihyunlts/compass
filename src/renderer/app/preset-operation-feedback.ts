import type { MessageKey } from '../../shared/i18n';
import type { PresetApplyStatus } from '../features/editor/presets';
import { i18n } from '../i18n.svelte';

const PRESET_APPLY_MESSAGE_KEY_BY_STATUS = {
  'device-insert-failed': 'status.deviceInsertFailed',
  'device-inserted': 'status.deviceInserted',
  'group-insert-failed': 'status.groupInsertFailed',
  'group-inserted': 'status.groupInserted',
  'rack-load-failed': 'status.rackLoadFailed',
  'rack-loaded': 'status.rackLoaded',
} as const satisfies Readonly<Record<PresetApplyStatus, MessageKey>>;

export const resolvePresetApplyMessage = (status: PresetApplyStatus): string =>
  i18n.t(PRESET_APPLY_MESSAGE_KEY_BY_STATUS[status]);

export type PresetInfoUpdateResult =
  | { status: 'updated' }
  | { status: 'error'; message: string };

export const formatPresetErrorMessage = (
  summaryKey: MessageKey,
  detail?: string | null,
): string => {
  const summary = i18n.t(summaryKey);
  const normalizedDetail = detail?.trim();
  if (!normalizedDetail || normalizedDetail === summary) {
    return summary;
  }

  return i18n.t('status.errorDetail', {
    summary: summary.trim().replace(/[.!?。]+$/u, ''),
    error: normalizedDetail,
  });
};

export class PresetOperationFeedback {
  public constructor(private readonly notify: (message: string) => void) {}

  public showMessage(message: string): void {
    this.notify(message);
  }

  public showError(summaryKey: MessageKey, detail?: string | null): void {
    this.showMessage(formatPresetErrorMessage(summaryKey, detail));
  }

  public async runPresetAction(
    action: () => Promise<void>,
    fallbackMessageKey: MessageKey,
  ): Promise<void> {
    try {
      await action();
    } catch (error) {
      this.showError(
        fallbackMessageKey,
        error instanceof Error ? error.message : null,
      );
    }
  }
}
