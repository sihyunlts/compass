import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { SPIRAL_NUMERIC_PARAMETERS } from './schema';

const SPIRAL_CENTER_PICKER_PARAM_KEYS = ['centerX', 'centerY'] as const;
const SPIRAL_TURNS_PARAM_KEYS = ['turns'] as const;

const isSpiralDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'spiral' }> =>
  device.kind === 'spiral';

export const spiralDeviceControls = {
  descriptors: {
    'set-spiral-param': {
      resolveMergeKey: createMergeKeyResolver('set-spiral-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        SPIRAL_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, SPIRAL_TURNS_PARAM_KEYS),
      ),
    },
    'set-center-picker-param': {
      resolveMergeKey: createMergeKeyResolver('set-center-picker-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        SPIRAL_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, SPIRAL_CENTER_PICKER_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-spiral-param': createNumericParameterSetter({
      isKind: isSpiralDevice,
      rules: SPIRAL_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, SPIRAL_TURNS_PARAM_KEYS),
    }),
    'set-center-picker-param': createNumericParameterSetter({
      isKind: isSpiralDevice,
      rules: SPIRAL_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, SPIRAL_CENTER_PICKER_PARAM_KEYS),
    }),
  }),
} satisfies RendererKindControlDefinition;
