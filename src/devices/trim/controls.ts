import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createDefaultNumericValueResolver,
  createMergeKeyResolver,
  resolveNumericDatasetParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import {
  createTimeWindowParamSetter,
  readTimeWindowParamKey,
} from '../time-window-controls';

const isTrimDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'trim' }> =>
  device.kind === 'trim';

export const trimDeviceControls = {
  descriptors: {
    'set-trim-param': {
      resolveMergeKey: createMergeKeyResolver('set-trim-param', resolveNumericDatasetParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        readTimeWindowParamKey,
      ),
    },
  },
  createHandlers: () => ({
    'set-trim-param': createTimeWindowParamSetter({
      isKind: isTrimDevice,
      readWindow: (device) => ({
        start: device.params.start,
        end: device.params.end,
      }),
      writeWindow: (device, nextWindow) => {
        device.params.start = nextWindow.start;
        device.params.end = nextWindow.end;
      },
    }),
  }),
} satisfies RendererKindControlDefinition;
