import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createDefaultNumericValueResolver,
  createMergeKeyResolver,
  createNumericParamSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { MIRROR_NUMERIC_PARAM_KEYS } from './schema';

const isMirrorDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'mirror' }> =>
  device.kind === 'mirror';

export const mirrorDeviceControls = {
  descriptors: {
    'set-angle-param': {
      resolveMergeKey: createMergeKeyResolver('set-angle-param', resolveNumericControlParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readControlParam(input, MIRROR_NUMERIC_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-angle-param': createNumericParamSetter({
      isKind: isMirrorDevice,
      readParam: (input) => readControlParam(input, MIRROR_NUMERIC_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = value;
      },
    }),
  }),
} satisfies RendererKindControlDefinition;
