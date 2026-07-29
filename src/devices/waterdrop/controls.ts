import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { WATERDROP_NUMERIC_PARAMETERS } from './schema';

const WATERDROP_CENTER_PICKER_PARAM_KEYS = ['centerX', 'centerY'] as const;
const WATERDROP_CURVATURE_PARAM_KEYS = ['curvature'] as const;

const isWaterdropDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'waterdrop' }> =>
  device.kind === 'waterdrop';

export const waterdropDeviceControls = {
  descriptors: {
    'set-waterdrop-param': {
      resolveMergeKey: createMergeKeyResolver('set-waterdrop-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        WATERDROP_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, WATERDROP_CURVATURE_PARAM_KEYS),
      ),
    },
    'set-center-picker-param': {
      resolveMergeKey: createMergeKeyResolver('set-center-picker-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        WATERDROP_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, WATERDROP_CENTER_PICKER_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-waterdrop-param': createNumericParameterSetter({
      isKind: isWaterdropDevice,
      rules: WATERDROP_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, WATERDROP_CURVATURE_PARAM_KEYS),
    }),
    'set-center-picker-param': createNumericParameterSetter({
      isKind: isWaterdropDevice,
      rules: WATERDROP_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, WATERDROP_CENTER_PICKER_PARAM_KEYS),
    }),
  }),
} satisfies RendererKindControlDefinition;
