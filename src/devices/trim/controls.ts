import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createDefaultNumericValueResolver,
  createMergeKeyResolver,
  createNumericParamSetter,
  readDatasetParam,
  resolveNumericDatasetParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { TRIM_NUMERIC_PARAM_KEYS } from './schema';

const isTrimDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'trim' }> =>
  device.kind === 'trim';

export const trimDeviceControls = {
  descriptors: {
    'set-trim-param': {
      resolveMergeKey: createMergeKeyResolver('set-trim-param', resolveNumericDatasetParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readDatasetParam(input, TRIM_NUMERIC_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-trim-param': createNumericParamSetter({
      isKind: isTrimDevice,
      readParam: (input) => readDatasetParam(input, TRIM_NUMERIC_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = value;
      },
    }),
  }),
} satisfies RendererKindControlDefinition;
