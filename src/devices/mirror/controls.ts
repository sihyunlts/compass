import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { MIRROR_NUMERIC_PARAMETERS } from './schema';

const MIRROR_ANGLE_PARAM_KEYS = ['angleDeg'] as const;

const isMirrorDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'mirror' }> =>
  device.kind === 'mirror';

export const mirrorDeviceControls = {
  descriptors: {
    'set-angle-param': {
      resolveMergeKey: createMergeKeyResolver('set-angle-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        MIRROR_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, MIRROR_ANGLE_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-angle-param': createNumericParameterSetter({
      isKind: isMirrorDevice,
      rules: MIRROR_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, MIRROR_ANGLE_PARAM_KEYS),
    }),
  }),
} satisfies RendererKindControlDefinition;
