import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { SCANNER_NUMERIC_PARAMETERS } from './schema';

const SCANNER_ANGLE_PARAM_KEYS = ['angleDeg'] as const;

const isScannerDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'scanner' }> =>
  device.kind === 'scanner';

export const scannerDeviceControls = {
  descriptors: {
    'set-angle-param': {
      resolveMergeKey: createMergeKeyResolver('set-angle-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        SCANNER_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, SCANNER_ANGLE_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-angle-param': createNumericParameterSetter({
      isKind: isScannerDevice,
      rules: SCANNER_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, SCANNER_ANGLE_PARAM_KEYS),
    }),
  }),
} satisfies RendererKindControlDefinition;
