import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createDefaultNumericValueResolver,
  createMergeKeyResolver,
  createNumericParamSetter,
  readDatasetParam,
  resolveNumericDatasetParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { STRETCH_NUMERIC_PARAM_KEYS } from './schema';

const isStretchDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'stretch' }> =>
  device.kind === 'stretch';

export const stretchDeviceControls = {
  descriptors: {
    'set-stretch-param': {
      resolveMergeKey: createMergeKeyResolver('set-stretch-param', resolveNumericDatasetParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readDatasetParam(input, STRETCH_NUMERIC_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-stretch-param': createNumericParamSetter({
      isKind: isStretchDevice,
      readParam: (input) => readDatasetParam(input, STRETCH_NUMERIC_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = value;
      },
    }),
  }),
} satisfies RendererKindControlDefinition;
