import {
  createRendererDeviceNode,
  getRendererDeviceControlDefinition,
  getRendererModulationTargetParamDefinitions,
  RENDERER_DEVICE_KINDS,
} from '../../../devices';
import { createMergeKeyResolver } from '../../../devices/control-helpers';
import type {
  RendererControlChange,
  RendererControlContext,
  RendererControlDescriptor,
  RendererControlHandler,
} from '../../../devices/control-types';
import type { GeneratorDeviceNode } from '../../../shared/model';

type ChainControlHandler = RendererControlHandler;

type ChainControlContext = Pick<
  RendererControlContext,
  'findDeviceById' | 'getMaskSourceGroupIds' | 'getMaskSourceGeneratorIds'
>;

const GENERIC_CONTROL_DESCRIPTORS: Readonly<Record<string, RendererControlDescriptor>> = {
  'set-device-enabled': {
    resolveMergeKey: createMergeKeyResolver('set-device-enabled'),
  },
};

const createGenericHandlers = (): Readonly<Record<string, ChainControlHandler>> => ({
  'set-device-enabled': (device, change) => {
    if (typeof change.value !== 'boolean') {
      return false;
    }
    device.enabled = change.value;
    return true;
  },
});

const composeDescriptor = (
  descriptors: readonly RendererControlDescriptor[],
): RendererControlDescriptor => ({
  resolveMergeKey: descriptors[0].resolveMergeKey,
  resolveDefaultValue: descriptors.some((descriptor) => descriptor.resolveDefaultValue)
    ? (defaultDevice, input) => {
        for (const descriptor of descriptors) {
          const value = descriptor.resolveDefaultValue?.(defaultDevice, input);
          if (value !== null && value !== undefined) {
            return value;
          }
        }
        return null;
      }
    : undefined,
});

const createDescriptorMap = (): Record<string, RendererControlDescriptor> => {
  const descriptorsByAction = new Map<string, RendererControlDescriptor[]>();

  for (const [action, descriptor] of Object.entries(GENERIC_CONTROL_DESCRIPTORS)) {
    descriptorsByAction.set(action, [descriptor]);
  }

  for (const kind of RENDERER_DEVICE_KINDS) {
    const controls = getRendererDeviceControlDefinition(kind);
    if (!controls?.descriptors) {
      continue;
    }

    for (const [action, descriptor] of Object.entries(controls.descriptors)) {
      const existing = descriptorsByAction.get(action);
      if (existing) {
        existing.push(descriptor);
        continue;
      }
      descriptorsByAction.set(action, [descriptor]);
    }
  }

  return Object.fromEntries(
    [...descriptorsByAction.entries()].map(([action, descriptors]) => [
      action,
      composeDescriptor(descriptors),
    ]),
  );
};

const CHAIN_CONTROL_DESCRIPTORS = createDescriptorMap();

const composeHandler = (
  handlers: readonly ChainControlHandler[],
): ChainControlHandler => (device, target) => {
  for (const handler of handlers) {
    if (handler(device, target)) {
      return true;
    }
  }
  return false;
};

const createFullControlContext = (
  context: ChainControlContext,
): RendererControlContext => ({
  ...context,
  getModulationTargetParamDefinitions: getRendererModulationTargetParamDefinitions,
});

export const createChainControlHandlers = (
  context: ChainControlContext,
): Record<string, ChainControlHandler> => {
  const handlersByAction = new Map<string, ChainControlHandler[]>();
  const appendHandlers = (handlers: Readonly<Record<string, ChainControlHandler>>): void => {
    for (const [action, handler] of Object.entries(handlers)) {
      const existing = handlersByAction.get(action);
      if (existing) {
        existing.push(handler);
        continue;
      }
      handlersByAction.set(action, [handler]);
    }
  };

  appendHandlers(createGenericHandlers());

  const fullContext = createFullControlContext(context);
  for (const kind of RENDERER_DEVICE_KINDS) {
    const handlers = getRendererDeviceControlDefinition(kind)?.createHandlers?.(fullContext);
    if (handlers) {
      appendHandlers(handlers);
    }
  }

  return Object.fromEntries(
    [...handlersByAction.entries()].map(([action, handlers]) => [
      action,
      composeHandler(handlers),
    ]),
  );
};

const resolveControlDescriptor = (change: RendererControlChange): RendererControlDescriptor | null =>
  CHAIN_CONTROL_DESCRIPTORS[change.action] ?? null;

export const applyChainControlChange = (
  change: RendererControlChange,
  findDeviceById: (id: string) => GeneratorDeviceNode | null,
  chainControlHandlers: Readonly<Record<string, ChainControlHandler>>,
): boolean => {
  if (!change.action || !change.deviceId) {
    return false;
  }

  const device = findDeviceById(change.deviceId);
  if (!device) {
    return false;
  }

  const handler = chainControlHandlers[change.action];
  return handler ? handler(device, change) : false;
};

export const resolveChainControlMergeKey = (
  change: RendererControlChange,
): string | null => {
  const descriptor = resolveControlDescriptor(change);
  return descriptor?.resolveMergeKey(change) ?? null;
};

export const resetNumericControlToDefault = (
  target: EventTarget | null,
  findDeviceById: (id: string) => GeneratorDeviceNode | null,
): RendererControlChange | null => {
  if (!(target instanceof HTMLInputElement) || target.type !== 'number') {
    return null;
  }

  const action = target.dataset.controlAction;
  const id = target.dataset.deviceId;
  const paramKey = target.dataset.param;
  if (!action || !id) {
    return null;
  }

  const device = findDeviceById(id);
  if (!device) {
    return null;
  }

  const baseChange: RendererControlChange = {
    action,
    deviceId: id,
    paramKey,
    value: target.value,
    finalize: true,
  };
  const descriptor = resolveControlDescriptor(baseChange);
  if (!descriptor) {
    return null;
  }
  const defaultDevice = createRendererDeviceNode(
    device.kind,
    device.id,
    device.enabled !== false,
  );
  const defaultValue = descriptor.resolveDefaultValue?.(defaultDevice, baseChange) ?? null;
  if (defaultValue === null) {
    return null;
  }

  const currentValue = Number(target.value);
  if (Number.isFinite(currentValue) && Math.abs(currentValue - defaultValue) < 0.0001) {
    return null;
  }

  target.value = String(defaultValue);
  return {
    ...baseChange,
    value: defaultValue,
    finalize: true,
  };
};
