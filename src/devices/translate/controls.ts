import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { TRANSLATE_NUMERIC_PARAMETERS } from './schema';

const TRANSLATE_PARAM_KEYS = ['offsetX', 'offsetY'] as const;

const isTranslateDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'translate' }> =>
  device.kind === 'translate';

export const translateDeviceControls = {
  descriptors: {
    'set-translate-param': {
      resolveMergeKey: createMergeKeyResolver('set-translate-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        TRANSLATE_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, TRANSLATE_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-translate-param': createNumericParameterSetter({
      isKind: isTranslateDevice,
      rules: TRANSLATE_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, TRANSLATE_PARAM_KEYS),
    }),
  }),
} satisfies RendererKindControlDefinition;
