import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createDefaultNumericValueResolver,
  createMergeKeyResolver,
  createNumericParamSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import {
  normalizeRainDensity,
  normalizeRainSeed,
  normalizeRainSpeed,
  RAIN_NUMERIC_PARAM_KEYS,
} from './schema';

const RAIN_ANGLE_PARAM_KEYS = ['angleDeg'] as const;

const isRainDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'rain' }> =>
  device.kind === 'rain';

export const rainDeviceControls = {
  descriptors: {
    'set-rain-param': {
      resolveMergeKey: createMergeKeyResolver('set-rain-param', resolveNumericControlParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readControlParam(input, RAIN_NUMERIC_PARAM_KEYS),
      ),
    },
    'set-angle-param': {
      resolveMergeKey: createMergeKeyResolver('set-angle-param', resolveNumericControlParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readControlParam(input, RAIN_ANGLE_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-rain-param': createNumericParamSetter({
      isKind: isRainDevice,
      readParam: (input) => readControlParam(input, RAIN_NUMERIC_PARAM_KEYS),
      assign: (device, param, value) => {
        if (param === 'seed') {
          device.params.seed = normalizeRainSeed(value);
          return;
        }
        if (param === 'density') {
          device.params.density = normalizeRainDensity(value);
          return;
        }
        if (param === 'speed') {
          device.params.speed = normalizeRainSpeed(value);
          return;
        }
        device.params.angleDeg = value;
      },
    }),
    'set-angle-param': createNumericParamSetter({
      isKind: isRainDevice,
      readParam: (input) => readControlParam(input, RAIN_ANGLE_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = value;
      },
    }),
  }),
} satisfies RendererKindControlDefinition;
