import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { STRETCH_NUMERIC_PARAMETERS } from './schema';

const STRETCH_PARAM_KEYS = ['start', 'end'] as const;

const isStretchDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'stretch' }> =>
  device.kind === 'stretch';

export const stretchDeviceControls = {
  descriptors: {
    'set-stretch-param': {
      resolveMergeKey: createMergeKeyResolver('set-stretch-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        STRETCH_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, STRETCH_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-stretch-param': createNumericParameterSetter({
      isKind: isStretchDevice,
      rules: STRETCH_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, STRETCH_PARAM_KEYS),
    }),
  }),
} satisfies RendererKindControlDefinition;
