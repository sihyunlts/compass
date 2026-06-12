import type { GeneratorDeviceNode } from '../../shared/model';
import {
  createDefaultNumericValueResolver,
  createMergeKeyResolver,
  resolveNumericControlParam,
} from '../control-helpers';
import type { RendererKindControlDefinition } from '../control-types';
import {
  createTimeWindowParamSetter,
  readTimeWindowParamKey,
} from '../time-window-controls';

const isStretchDevice = (
  device: GeneratorDeviceNode,
): device is Extract<GeneratorDeviceNode, { kind: 'stretch' }> =>
  device.kind === 'stretch';

export const stretchDeviceControls = {
  descriptors: {
    'set-stretch-param': {
      resolveMergeKey: createMergeKeyResolver('set-stretch-param', resolveNumericControlParam),
      resolveDefaultValue: createDefaultNumericValueResolver(
        readTimeWindowParamKey,
      ),
    },
  },
  createHandlers: () => ({
    'set-stretch-param': createTimeWindowParamSetter({
      isKind: isStretchDevice,
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
