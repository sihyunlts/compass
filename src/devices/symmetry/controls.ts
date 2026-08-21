import { resolveSymmetryResultCount } from '../../core/symmetry';
import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createMergeKeyResolver,
  createNumericParameterDefaultResolver,
  createNumericParameterSetter,
  readControlParam,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import { SYMMETRY_NUMERIC_PARAMETERS } from './schema';

const SYMMETRY_PARAM_KEYS = ['count', 'directionDeg'] as const;
const SYMMETRY_CENTER_PARAM_KEYS = ['centerX', 'centerY'] as const;

const isSymmetryDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'symmetry' }> =>
  device.kind === 'symmetry';

export const symmetryDeviceControls = {
  descriptors: {
    'set-symmetry-mode': {
      resolveMergeKey: createMergeKeyResolver('set-symmetry-mode'),
    },
    'set-symmetry-source-scope': {
      resolveMergeKey: createMergeKeyResolver('set-symmetry-source-scope'),
    },
    'set-symmetry-param': {
      resolveMergeKey: createMergeKeyResolver('set-symmetry-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        SYMMETRY_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, SYMMETRY_PARAM_KEYS),
      ),
    },
    'set-center-picker-param': {
      resolveMergeKey: createMergeKeyResolver('set-center-picker-param', resolveNumericControlParam),
      resolveDefaultValue: createNumericParameterDefaultResolver(
        SYMMETRY_NUMERIC_PARAMETERS,
        (input) => readControlParam(input, SYMMETRY_CENTER_PARAM_KEYS),
      ),
    },
  },
  createHandlers: () => ({
    'set-symmetry-mode': (device, change) => {
      if (
        !isSymmetryDevice(device)
        || change.value !== 'reflection' && change.value !== 'rotation'
      ) {
        return false;
      }

      device.params.mode = change.value;
      device.params.count = resolveSymmetryResultCount(
        device.params.mode,
        device.params.count,
      );
      return true;
    },
    'set-symmetry-source-scope': (device, change) => {
      if (
        !isSymmetryDevice(device)
        || change.value !== 'sector' && change.value !== 'entire'
      ) {
        return false;
      }

      device.params.sourceScope = change.value;
      return true;
    },
    'set-symmetry-param': createNumericParameterSetter({
      isKind: isSymmetryDevice,
      rules: SYMMETRY_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, SYMMETRY_PARAM_KEYS),
    }),
    'set-center-picker-param': createNumericParameterSetter({
      isKind: isSymmetryDevice,
      rules: SYMMETRY_NUMERIC_PARAMETERS,
      readParam: (input) => readControlParam(input, SYMMETRY_CENTER_PARAM_KEYS),
    }),
  }),
} satisfies RendererKindControlDefinition;
