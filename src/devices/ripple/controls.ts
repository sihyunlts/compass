import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { RIPPLE_NUMERIC_PARAMETERS } from './schema';

const RIPPLE_CENTER_PICKER_PARAM_KEYS = ['centerX', 'centerY'] as const;
const RIPPLE_CURVATURE_PARAM_KEYS = ['curvature'] as const;

const isRippleDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'ripple' }> =>
  device.kind === 'ripple';

export const rippleDeviceControls = {
  descriptors: {
    'set-ripple-param': {
      resolveMergeKey: createMergeKeyResolver(
        'set-ripple-param',
        resolveNumericControlParam,
      ),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        RIPPLE_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, RIPPLE_CURVATURE_PARAM_KEYS),
      ),
    },
    'set-center-picker-param': {
      resolveMergeKey: createMergeKeyResolver('set-center-picker-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        RIPPLE_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, RIPPLE_CENTER_PICKER_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-ripple-param': createNumericParameterSetter({
      isKind: isRippleDevice,
      rules: RIPPLE_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, RIPPLE_CURVATURE_PARAM_KEYS),
    }),
    'set-center-picker-param': createNumericParameterSetter({
      isKind: isRippleDevice,
      rules: RIPPLE_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, RIPPLE_CENTER_PICKER_PARAM_KEYS),
    }),
  }),
} satisfies RendererKindControlDefinition;
