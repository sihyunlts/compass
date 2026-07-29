import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { SCALE_NUMERIC_PARAMETERS } from './schema';

const SCALE_CENTER_PICKER_PARAM_KEYS = ['centerX', 'centerY'] as const;
const SCALE_FACTOR_PARAM_KEYS = ['scaleX', 'scaleY'] as const;

const isScaleDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'scale' }> =>
  device.kind === 'scale';

export const scaleDeviceControls = {
  descriptors: {
    'set-scale-param': {
      resolveMergeKey: createMergeKeyResolver('set-scale-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        SCALE_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, SCALE_FACTOR_PARAM_KEYS),
      ),
    },
    'set-center-picker-param': {
      resolveMergeKey: createMergeKeyResolver('set-center-picker-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        SCALE_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, SCALE_CENTER_PICKER_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-scale-param': createNumericParameterSetter({
      isKind: isScaleDevice,
      rules: SCALE_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, SCALE_FACTOR_PARAM_KEYS),
    }),
    'set-center-picker-param': createNumericParameterSetter({
      isKind: isScaleDevice,
      rules: SCALE_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, SCALE_CENTER_PICKER_PARAM_KEYS),
    }),
  }),
} satisfies RendererKindControlDefinition;
