import {
  createMergeKeyResolver,
  parseFiniteControlNumber,
  parseStructuredControlValue,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { sanitizeCurveDivisions } from '../../core/curve-divisions';
import { sanitizeCurveNodes } from '../../core/modulation/curve';
import {
  DEFAULT_MODULATION_TARGET_AMOUNT,
  createModulationTargetId,
  isValidModulationTargetSlotIndex,
  sanitizeModulationTarget,
  sanitizeModulationTargetAmount,
} from '../../core/modulation/targets';
import type { CurveModulatorNode, ModulationTarget } from '../../shared/model';

const readTargetId = (change: { paramKey?: string }): string | null => {
  const targetId = change.paramKey?.trim() ?? '';
  return targetId || null;
};

const findTargetById = (
  device: CurveModulatorNode,
  targetId: string,
): ModulationTarget | null =>
  device.params.targets.find((target) => target.id === targetId) ?? null;

export const modulatorDeviceControls = {
  descriptors: {
    'assign-modulation-target-slot': {
      resolveMergeKey: () => null,
    },
    'clear-modulation-target-slot': {
      resolveMergeKey: () => null,
    },
    'set-modulation-target-amount': {
      resolveMergeKey: createMergeKeyResolver('set-modulation-target-amount', readTargetId),
      resolveDefaultValue: (defaultDevice, change) =>
        defaultDevice.kind === 'modulator' && readTargetId(change)
          ? DEFAULT_MODULATION_TARGET_AMOUNT
          : null,
    },
    'set-modulation-divisions': {
      resolveMergeKey: createMergeKeyResolver('set-modulation-divisions'),
    },
    'set-modulation-curve-nodes': {
      resolveMergeKey: createMergeKeyResolver('set-modulation-curve-nodes'),
    },
  },
  createHandlers: (context) => ({
    'assign-modulation-target-slot': (device, change) => {
      if (device.kind !== 'modulator') {
        return false;
      }

      if (!change.value || typeof change.value !== 'object') {
        return false;
      }

      const slotIndex = (change.value as { slotIndex?: unknown }).slotIndex;
      if (!isValidModulationTargetSlotIndex(slotIndex)) {
        return false;
      }

      const requestedDeviceId = typeof (change.value as { deviceId?: unknown }).deviceId === 'string'
        ? (change.value as { deviceId: string }).deviceId.trim()
        : '';
      const requestedParamKey = typeof (change.value as { paramKey?: unknown }).paramKey === 'string'
        ? (change.value as { paramKey: string }).paramKey.trim()
        : '';
      if (!requestedDeviceId || !requestedParamKey) {
        return false;
      }

      const targetDevice = context.findDeviceById(requestedDeviceId);
      if (!targetDevice) {
        return false;
      }

      const paramOptions = context.getModulationTargetParamDefinitions(targetDevice.kind);
      if (!paramOptions.some((option) => option.key === requestedParamKey)) {
        return false;
      }

      const existingTarget = device.params.targets.find((target) =>
        target.deviceId === requestedDeviceId
        && target.paramKey === requestedParamKey) ?? null;
      if (existingTarget) {
        return false;
      }

      const previousTarget = device.params.targets.find((target) => target.slotIndex === slotIndex) ?? null;
      const target = sanitizeModulationTarget({
        id: previousTarget?.id ?? createModulationTargetId(),
        slotIndex,
        deviceId: requestedDeviceId,
        paramKey: requestedParamKey,
        amount: previousTarget?.amount ?? DEFAULT_MODULATION_TARGET_AMOUNT,
      });
      if (!target) {
        return false;
      }

      device.params.targets = [
        ...device.params.targets.filter((item) =>
          item.slotIndex !== slotIndex
          && !(item.deviceId === requestedDeviceId && item.paramKey === requestedParamKey)),
        target,
      ].sort((left, right) => left.slotIndex - right.slotIndex);
      return true;
    },
    'clear-modulation-target-slot': (device, change) => {
      if (device.kind !== 'modulator') {
        return false;
      }

      const slotIndex = change.value;
      if (!isValidModulationTargetSlotIndex(slotIndex)) {
        return false;
      }

      const nextTargets = device.params.targets.filter((target) => target.slotIndex !== slotIndex);
      if (nextTargets.length === device.params.targets.length) {
        return false;
      }
      device.params.targets = nextTargets;
      return true;
    },
    'set-modulation-target-amount': (device, change) => {
      if (device.kind !== 'modulator') {
        return false;
      }

      const targetId = readTargetId(change);
      if (!targetId) {
        return false;
      }

      const target = findTargetById(device, targetId);
      if (!target) {
        return false;
      }

      const value = parseFiniteControlNumber(change.value);
      if (value === null) {
        return false;
      }

      target.amount = sanitizeModulationTargetAmount(value);
      return true;
    },
    'set-modulation-divisions': (device, change) => {
      if (device.kind !== 'modulator') {
        return false;
      }

      device.params.curve.divisions = sanitizeCurveDivisions(change.value);
      return true;
    },
    'set-modulation-curve-nodes': (device, change) => {
      if (device.kind !== 'modulator') {
        return false;
      }

      const parsed = parseStructuredControlValue(change.value);
      if (!parsed.ok) {
        return false;
      }

      device.params.curve.nodes = sanitizeCurveNodes(parsed.value);
      return true;
    },
  }),
} satisfies RendererKindControlDefinition;
