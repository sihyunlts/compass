import { createRendererDeviceNode } from '../../../../devices';
import { createDeviceControlHandlers, DEVICE_CONTROL_DESCRIPTORS } from './device-handlers';
import { createMaskControlHandlers, MASK_CONTROL_DESCRIPTORS } from './mask-handlers';
import {
  createModulationControlHandlers,
  MODULATION_CONTROL_DESCRIPTORS,
} from './modulation-handlers';
import type { ChainControlContext, ChainControlDescriptor, ChainControlHandler } from './shared';
import { getControlTarget } from './shared';

const CHAIN_CONTROL_DESCRIPTORS: Record<string, ChainControlDescriptor> = {
  ...DEVICE_CONTROL_DESCRIPTORS,
  ...MASK_CONTROL_DESCRIPTORS,
  ...MODULATION_CONTROL_DESCRIPTORS,
};

const resolveControlDescriptor = (
  control: ReturnType<typeof getControlTarget>,
): ChainControlDescriptor | null => {
  if (!control) {
    return null;
  }

  const action = control.dataset.action;
  if (!action) {
    return null;
  }
  return CHAIN_CONTROL_DESCRIPTORS[action] ?? null;
};

export const createChainControlHandlers = (
  context: ChainControlContext,
): Record<string, ChainControlHandler> => ({
  ...createDeviceControlHandlers(),
  ...createMaskControlHandlers(context),
  ...createModulationControlHandlers({
    findDeviceById: context.findDeviceById,
  }),
});

export const applyChainControlChange = (
  target: EventTarget | null,
  findDeviceById: (id: string) => Parameters<ChainControlHandler>[0] | null,
  chainControlHandlers: Readonly<Record<string, ChainControlHandler>>,
): boolean => {
  const control = getControlTarget(target);
  if (!control) {
    return false;
  }

  const action = control.dataset.action;
  const id = control.dataset.id;
  if (!action || !id) {
    return false;
  }

  const device = findDeviceById(id);
  if (!device) {
    return false;
  }

  const handler = chainControlHandlers[action];
  return handler ? handler(device, control) : false;
};

export const resolveChainControlMergeKey = (
  target: EventTarget | null,
): string | null => {
  const control = getControlTarget(target);
  const descriptor = resolveControlDescriptor(control);
  return descriptor?.resolveMergeKey(control) ?? null;
};

export const resetNumericControlToDefault = (
  target: EventTarget | null,
  findDeviceById: (id: string) => Parameters<ChainControlHandler>[0] | null,
  chainControlHandlers: Readonly<Record<string, ChainControlHandler>>,
): boolean => {
  if (!(target instanceof HTMLInputElement) || target.type !== 'number') {
    return false;
  }

  const action = target.dataset.action;
  const id = target.dataset.id;
  const descriptor = resolveControlDescriptor(target);
  if (!action || !id || !descriptor || !chainControlHandlers[action]) {
    return false;
  }

  const device = findDeviceById(id);
  if (!device) {
    return false;
  }

  const defaultDevice = createRendererDeviceNode(
    device.kind,
    device.id,
    device.enabled !== false,
  );
  const defaultValue = descriptor.resolveDefaultValue?.(defaultDevice, target) ?? null;
  if (defaultValue === null) {
    return false;
  }

  const currentValue = Number(target.value);
  if (Number.isFinite(currentValue) && Math.abs(currentValue - defaultValue) < 0.0001) {
    return false;
  }

  target.value = String(defaultValue);
  target.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
};
