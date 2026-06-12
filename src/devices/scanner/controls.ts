import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createDefaultNumericValueResolver,
  createMergeKeyResolver,
  createNumericParamSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { SCANNER_NUMERIC_PARAM_KEYS } from './schema';

const SCANNER_ANGLE_PARAM_KEYS = ['angleDeg'] as const;

const isScannerDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'scanner' }> =>
  device.kind === 'scanner';

export const scannerDeviceControls = {
  descriptors: {
    'set-scanner-param': {
      resolveMergeKey: createMergeKeyResolver('set-scanner-param', resolveNumericControlParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readControlParam(input, SCANNER_NUMERIC_PARAM_KEYS),
      ),
    },
    'set-angle-param': {
      resolveMergeKey: createMergeKeyResolver('set-angle-param', resolveNumericControlParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readControlParam(input, SCANNER_ANGLE_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-scanner-param': createNumericParamSetter({
      isKind: isScannerDevice,
      readParam: (input) => readControlParam(input, SCANNER_NUMERIC_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = value;
      },
    }),
    'set-angle-param': createNumericParamSetter({
      isKind: isScannerDevice,
      readParam: (input) => readControlParam(input, SCANNER_ANGLE_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = value;
      },
    }),
  }),
} satisfies RendererKindControlDefinition;
