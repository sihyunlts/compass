import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { ROTATE_NUMERIC_PARAMETERS } from './schema';

const ROTATE_ANGLE_PARAM_KEYS = ['angleDeg'] as const;
const ROTATE_CENTER_PICKER_PARAM_KEYS = ['centerX', 'centerY'] as const;

const isRotateDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'rotate' }> =>
  device.kind === 'rotate';

export const rotateDeviceControls = {
  descriptors: {
    'set-rotate-param': {
      resolveMergeKey: createMergeKeyResolver('set-rotate-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        ROTATE_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, ROTATE_ANGLE_PARAM_KEYS),
      ),
    },
    'set-center-picker-param': {
      resolveMergeKey: createMergeKeyResolver('set-center-picker-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        ROTATE_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, ROTATE_CENTER_PICKER_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-rotate-param': createNumericParameterSetter({
      isKind: isRotateDevice,
      rules: ROTATE_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, ROTATE_ANGLE_PARAM_KEYS),
    }),
    'set-center-picker-param': createNumericParameterSetter({
      isKind: isRotateDevice,
      rules: ROTATE_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, ROTATE_CENTER_PICKER_PARAM_KEYS),
    }),
  }),
} satisfies RendererKindControlDefinition;
