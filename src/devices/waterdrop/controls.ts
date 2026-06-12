import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createDefaultNumericValueResolver,
  createMergeKeyResolver,
  createNumericParamSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { WATERDROP_NUMERIC_PARAM_KEYS } from './schema';

const WATERDROP_CENTER_PICKER_PARAM_KEYS = ['centerX', 'centerY'] as const;

const isWaterdropDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'waterdrop' }> =>
  device.kind === 'waterdrop';

export const waterdropDeviceControls = {
  descriptors: {
    'set-waterdrop-param': {
      resolveMergeKey: createMergeKeyResolver('set-waterdrop-param', resolveNumericControlParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readControlParam(input, WATERDROP_NUMERIC_PARAM_KEYS),
      ),
    },
    'set-center-picker-param': {
      resolveMergeKey: createMergeKeyResolver('set-center-picker-param', resolveNumericControlParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readControlParam(input, WATERDROP_CENTER_PICKER_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-waterdrop-param': createNumericParamSetter({
      isKind: isWaterdropDevice,
      readParam: (input) => readControlParam(input, WATERDROP_NUMERIC_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = value;
      },
    }),
    'set-center-picker-param': createNumericParamSetter({
      isKind: isWaterdropDevice,
      readParam: (input) => readControlParam(input, WATERDROP_CENTER_PICKER_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = value;
      },
    }),
  }),
} satisfies RendererKindControlDefinition;
