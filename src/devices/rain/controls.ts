import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { RAIN_NUMERIC_PARAMETERS } from './schema';

const RAIN_PARAM_KEYS = ['seed', 'density', 'speed'] as const;
const RAIN_ANGLE_PARAM_KEYS = ['angleDeg'] as const;

const isRainDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'rain' }> =>
  device.kind === 'rain';

export const rainDeviceControls = {
  descriptors: {
    'set-rain-param': {
      resolveMergeKey: createMergeKeyResolver('set-rain-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        RAIN_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, RAIN_PARAM_KEYS),
      ),
    },
    'set-angle-param': {
      resolveMergeKey: createMergeKeyResolver('set-angle-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        RAIN_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, RAIN_ANGLE_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-rain-param': createNumericParameterSetter({
      isKind: isRainDevice,
      rules: RAIN_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, RAIN_PARAM_KEYS),
    }),
    'set-angle-param': createNumericParameterSetter({
      isKind: isRainDevice,
      rules: RAIN_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, RAIN_ANGLE_PARAM_KEYS),
    }),
  }),
} satisfies RendererKindControlDefinition;
