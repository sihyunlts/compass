import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createDefaultNumericValueResolver,
  createMergeKeyResolver,
  createNumericParamSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { normalizePositiveScaleFactor } from './schema';

const SCALE_CENTER_PICKER_PARAM_KEYS = ['centerX', 'centerY'] as const;
const SCALE_FACTOR_PARAM_KEYS = ['scaleX', 'scaleY'] as const;

const isScaleDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'scale' }> =>
  device.kind === 'scale';

export const scaleDeviceControls = {
  descriptors: {
    'set-scale-param': {
      resolveMergeKey: createMergeKeyResolver('set-scale-param', resolveNumericControlParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readControlParam(input, SCALE_FACTOR_PARAM_KEYS),
      ),
    },
    'set-center-picker-param': {
      resolveMergeKey: createMergeKeyResolver('set-center-picker-param', resolveNumericControlParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readControlParam(input, SCALE_CENTER_PICKER_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-scale-param': createNumericParamSetter({
      isKind: isScaleDevice,
      readParam: (input) => readControlParam(input, SCALE_FACTOR_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = normalizePositiveScaleFactor(value, device.params[param]);
      },
    }),
    'set-center-picker-param': createNumericParamSetter({
      isKind: isScaleDevice,
      readParam: (input) => readControlParam(input, SCALE_CENTER_PICKER_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = value;
      },
    }),
  }),
} satisfies RendererKindControlDefinition;
