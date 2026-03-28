import type { GeneratorDeviceNode } from '../shared/model';

export const doesDeviceToggleTimelineParity = (
  device: GeneratorDeviceNode,
): boolean => device.kind === 'reverse';
