export interface RackControlTarget {
  element: HTMLElement;
  action: string;
  deviceId: string;
  paramKey: string | null;
}

export const RACK_CONTROL_TARGET_SELECTOR = '[data-control-action][data-device-id]';
export const RACK_CONTROL_TARGET_WITH_PARAM_SELECTOR = `${RACK_CONTROL_TARGET_SELECTOR}[data-param]`;
export const RACK_NUMERIC_INPUT_SELECTOR = `input[type="number"]${RACK_CONTROL_TARGET_SELECTOR}`;

export const readRackControlTarget = (
  element: HTMLElement,
): RackControlTarget | null => {
  const action = element.dataset.controlAction?.trim() ?? '';
  const deviceId = element.dataset.deviceId?.trim() ?? '';
  if (!action || !deviceId) {
    return null;
  }

  const paramKey = element.dataset.param?.trim() ?? '';
  return {
    element,
    action,
    deviceId,
    paramKey: paramKey || null,
  };
};

export const closestRackControlTarget = (
  target: EventTarget | null,
  options: {
    requireParam?: boolean;
    deviceId?: string;
    paramKeys?: ReadonlySet<string>;
  } = {},
): RackControlTarget | null => {
  if (!(target instanceof Element)) {
    return null;
  }

  const control = target.closest<HTMLElement>(
    options.requireParam
      ? RACK_CONTROL_TARGET_WITH_PARAM_SELECTOR
      : RACK_CONTROL_TARGET_SELECTOR,
  );
  if (!control) {
    return null;
  }

  const resolved = readRackControlTarget(control);
  if (!resolved) {
    return null;
  }

  if (options.deviceId && resolved.deviceId !== options.deviceId) {
    return null;
  }

  if (options.paramKeys && (!resolved.paramKey || !options.paramKeys.has(resolved.paramKey))) {
    return null;
  }

  return resolved;
};

export const closestRackNumericInput = (
  target: EventTarget | null,
): HTMLInputElement | null => {
  if (!(target instanceof Element)) {
    return null;
  }

  const input = target.closest<HTMLInputElement>(RACK_NUMERIC_INPUT_SELECTOR);
  return input && readRackControlTarget(input) ? input : null;
};

export const isRackNumericInput = (
  target: EventTarget | null,
): target is HTMLInputElement => (
  target instanceof HTMLInputElement
  && target.type === 'number'
  && readRackControlTarget(target) !== null
);
