import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { TRIM_NUMERIC_PARAMETERS } from './schema';

const TRIM_PARAM_KEYS = ['start', 'end'] as const;

const isTrimDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'trim' }> =>
  device.kind === 'trim';

export const trimDeviceControls = {
  descriptors: {
    'set-trim-param': {
      resolveMergeKey: createMergeKeyResolver('set-trim-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        TRIM_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, TRIM_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-trim-param': createNumericParameterSetter({
      isKind: isTrimDevice,
      rules: TRIM_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, TRIM_PARAM_KEYS),
    }),
  }),
} satisfies RendererKindControlDefinition;
