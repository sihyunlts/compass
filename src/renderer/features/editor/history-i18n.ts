import { applyNameIndex } from '../../../shared/model/naming';
import { resolveDeviceNameSnapshot } from '../rack/display-names';
import { getDeviceMessageKey } from '../../device-i18n';
import { i18n } from '../../i18n.svelte';
import type { MessageKey } from '../../../shared/i18n';
import type { ChainHistoryAction, ChainHistoryKind } from './history-core';

const namedActionKeys: Partial<Record<ChainHistoryKind, MessageKey>> = {
  'add-device': 'history.named.add-device',
  'insert-device': 'history.named.insert-device',
  'insert-devices': 'history.named.insert-devices',
  'move-devices': 'history.named.move-devices',
  'delete-devices': 'history.named.delete-devices',
  'rename-group': 'history.named.rename-device',
  'edit-group-info': 'history.named.edit-device-info',
  'group-create': 'history.named.group-create',
  'group-ungroup': 'history.named.group-ungroup',
  'group-toggle-enabled': 'history.named.device-enabled',
  'group-toggle-isolate': 'history.named.group-toggle-isolate',
  'rename-device': 'history.named.rename-device',
  'edit-device-info': 'history.named.edit-device-info',
  'clipboard-cut': 'history.named.clipboard-cut',
  'clipboard-paste': 'history.named.clipboard-paste',
  duplicate: 'history.named.duplicate',
  'insert-device-preset': 'history.named.insert-device-preset',
  'insert-group-preset': 'history.named.insert-group-preset',
  'mask-tile-edit': 'history.named.mask-tile-edit',
};

export const resolveHistoryActionPresentation = (action: ChainHistoryAction) => {
  const label = action.parameterLabelKey
    ? i18n.t('history.editParameter', { parameter: i18n.t(action.parameterLabelKey) })
    : i18n.t(`history.action.${action.kind}`);
  const names = (action.targets ?? []).map((device) =>
    device.kind === 'group'
      ? device.customName ?? applyNameIndex(i18n.t('group.defaultTemplate'), device.index)
      : resolveDeviceNameSnapshot(device, (kind) => i18n.t(getDeviceMessageKey(kind))));
  if (names.length === 0) {
    return { label, beforeTarget: label, targetName: '', additionalTargets: '', afterTarget: '' };
  }
  const targetName = names[0];
  const additionalTargets = names.length > 1
    ? i18n.t('history.additionalTargets', { count: names.length - 1 })
    : '';

  const templateKey = action.parameterLabelKey === 'control.deviceEnabled'
    ? 'history.named.device-enabled'
    : namedActionKeys[action.kind] ?? 'history.namedAction';
  const template = i18n.t(templateKey);
  const [beforeTarget, afterTarget] = template.split('{device}');
  const before = beforeTarget.replace('{action}', () => label);
  const after = afterTarget.replace('{action}', () => label);
  return {
    label: `${before}${names.join(', ')}${after}`,
    beforeTarget: before,
    targetName,
    additionalTargets,
    afterTarget: after,
  };
};

export const resolveHistoryActionLabel = (action: ChainHistoryAction): string => {
  return resolveHistoryActionPresentation(action).label;
};
