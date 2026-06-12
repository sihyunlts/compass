import {
  createMergeKeyResolver,
  parseFiniteControlNumber,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { sanitizeCurveDivisions, sanitizeCurveNodes } from '../../core/modulation/curve';
import { sanitizeModulationTarget } from '../../core/modulation/routing';

export const modulatorDeviceControls = {
  descriptors: {
    'set-modulation-target-device': {
      resolveMergeKey: createMergeKeyResolver('set-modulation-target-device'),
    },
    'set-modulation-target-param': {
      resolveMergeKey: createMergeKeyResolver('set-modulation-target-param'),
    },
    'set-modulation-amount': {
      resolveMergeKey: createMergeKeyResolver('set-modulation-amount'),
      resolveDefaultValue: (defaultDevice) =>
        defaultDevice.kind === 'modulator'
          ? defaultDevice.params.amount
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
    'set-modulation-target-device': (device, change) => {
      if (device.kind !== 'modulator') {
        return false;
      }

      if (typeof change.value !== 'string') {
        return false;
      }

      const deviceId = change.value.trim();
      if (!deviceId) {
        device.params.target = null;
        return true;
      }

      const targetDevice = context.findDeviceById(deviceId);
      if (!targetDevice) {
        device.params.target = null;
        return true;
      }

      const paramOptions = context.getModulationTargetParamDefinitions(targetDevice.kind);
      if (paramOptions.length === 0) {
        device.params.target = null;
        return true;
      }

      const currentParamKey = device.params.target?.paramKey ?? '';
      const nextParamKey = paramOptions.some((item) => item.key === currentParamKey)
        ? currentParamKey
        : paramOptions[0].key;

      device.params.target = sanitizeModulationTarget({
        deviceId,
        paramKey: nextParamKey,
      });
      return true;
    },
    'set-modulation-target-param': (device, change) => {
      if (device.kind !== 'modulator') {
        return false;
      }

      if (typeof change.value !== 'string') {
        return false;
      }

      const paramKey = change.value.trim();
      if (!paramKey) {
        device.params.target = null;
        return true;
      }

      const currentDeviceId = device.params.target?.deviceId ?? '';
      if (!currentDeviceId) {
        return false;
      }

      device.params.target = sanitizeModulationTarget({
        deviceId: currentDeviceId,
        paramKey,
      });
      return true;
    },
    'set-modulation-amount': (device, change) => {
      if (device.kind !== 'modulator') {
        return false;
      }

      const value = parseFiniteControlNumber(change.value);
      if (value === null) {
        return false;
      }

      device.params.amount = value;
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

      let parsed: unknown;
      if (typeof change.value === 'string') {
        try {
          parsed = JSON.parse(change.value);
        } catch {
          return false;
        }
      } else {
        parsed = change.value;
      }

      device.params.curve.nodes = sanitizeCurveNodes(parsed);
      return true;
    },
  }),
} satisfies RendererKindControlDefinition;
