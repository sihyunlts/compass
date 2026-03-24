import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createDefaultNumericValueResolver,
  createMergeKeyResolver,
  createNumericParamSetter,
  readDatasetParam,
  resolveNumericDatasetParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { TRANSLATE_NUMERIC_PARAM_KEYS } from './schema';

const isTranslateDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'translate' }> =>
  device.kind === 'translate';

export const translateDeviceControls = {
  descriptors: {
    'set-translate-param': {
      resolveMergeKey: createMergeKeyResolver('set-translate-param', resolveNumericDatasetParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readDatasetParam(input, TRANSLATE_NUMERIC_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-translate-param': createNumericParamSetter({
      isKind: isTranslateDevice,
      readParam: (input) => readDatasetParam(input, TRANSLATE_NUMERIC_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = value;
      },
    }),
  }),
} satisfies RendererKindControlDefinition;
