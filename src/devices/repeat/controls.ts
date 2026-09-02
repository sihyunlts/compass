import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { REPEAT_NUMERIC_PARAMETERS } from './schema';

const REPEAT_PARAM_KEYS = ['count', 'intervalPercent'] as const;

const isRepeatDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'repeat' }> =>
  device.kind === 'repeat';

export const repeatDeviceControls = {
  descriptors: {
    'set-repeat-param': {
      resolveMergeKey: createMergeKeyResolver('set-repeat-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        REPEAT_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, REPEAT_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-repeat-param': createNumericParameterSetter({
      isKind: isRepeatDevice,
      rules: REPEAT_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, REPEAT_PARAM_KEYS),
    }),
  }),
} satisfies RendererKindControlDefinition;
