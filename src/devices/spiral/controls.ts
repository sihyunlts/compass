import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createDefaultNumericValueResolver,
  createMergeKeyResolver,
  createNumericParamSetter,
  readDatasetParam,
  resolveNumericDatasetParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { SPIRAL_NUMERIC_PARAM_KEYS } from './schema';

const SPIRAL_CENTER_PICKER_PARAM_KEYS = ['centerX', 'centerY'] as const;

const isSpiralDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'spiral' }> =>
  device.kind === 'spiral';

export const spiralDeviceControls = {
  descriptors: {
    'set-spiral-param': {
      resolveMergeKey: createMergeKeyResolver('set-spiral-param', resolveNumericDatasetParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readDatasetParam(input, SPIRAL_NUMERIC_PARAM_KEYS),
      ),
    },
    'set-center-picker-param': {
      resolveMergeKey: createMergeKeyResolver('set-center-picker-param', resolveNumericDatasetParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        (input) => readDatasetParam(input, SPIRAL_CENTER_PICKER_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-spiral-param': createNumericParamSetter({
      isKind: isSpiralDevice,
      readParam: (input) => readDatasetParam(input, SPIRAL_NUMERIC_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = value;
      },
    }),
    'set-center-picker-param': createNumericParamSetter({
      isKind: isSpiralDevice,
      readParam: (input) => readDatasetParam(input, SPIRAL_CENTER_PICKER_PARAM_KEYS),
      assign: (device, param, value) => {
        device.params[param] = value;
      },
    }),
  }),
} satisfies RendererKindControlDefinition;
