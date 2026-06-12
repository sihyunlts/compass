import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createDefaultNumericValueResolver,
  createMergeKeyResolver,
  createNumericParamSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { ROTATE_NUMERIC_PARAM_KEYS } from './schema';

const isRotateDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'rotate' }> =>
  device.kind === 'rotate';

export const rotateDeviceControls = {
  descriptors: {
    'set-angle-param': {
      resolveMergeKey: createMergeKeyResolver('set-angle-param', resolveNumericControlParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readControlParam(input, ROTATE_NUMERIC_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-angle-param': createNumericParamSetter({
      isKind: isRotateDevice,
      readParam: (input) => readControlParam(input, ROTATE_NUMERIC_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = value;
      },
    }),
  }),
} satisfies RendererKindControlDefinition;
