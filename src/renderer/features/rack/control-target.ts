export interface RackControlTarget {
  element: HTMLElement;
  action: string;
  deviceId: string;
  paramKey: string | null;
}

export const RACK_CONTROL_TARGET_SELECTOR = '[data-control-action][data-device-id]';
export const RACK_CONTROL_TARGET_WITH_PARAM_SELECTOR = `${RACK_CONTROL_TARGET_SELECTOR}[data-param]`;
export const RACK_NUMERIC_INPUT_SELECTOR = `input[type="number"]${RACK_CONTROL_TARGET_SELECTOR}`;
const RACK_NUMERIC_INPUT_PROXY_SELECTOR =
  `[data-numeric-input-proxy]${RACK_CONTROL_TARGET_SELECTOR}`;
const RACK_NUMERIC_INPUT_SCOPE_SELECTOR = '[data-numeric-input-scope]';

interface RackNumericInputTarget {
  input: HTMLInputElement;
  pointerElement: HTMLElement;
}

const controlsMatch = (
  left: RackControlTarget,
  right: RackControlTarget,
): boolean => (
  left.action === right.action
  && left.deviceId === right.deviceId
  && left.paramKey === right.paramKey
);

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

export const closestRackNumericInputTarget = (
  target: EventTarget | null,
): RackNumericInputTarget | null => {
  if (!(target instanceof Element)) {
    return null;
  }

  const input = target.closest<HTMLInputElement>(RACK_NUMERIC_INPUT_SELECTOR);
  if (input && readRackControlTarget(input)) {
    return {
      input,
      pointerElement: input,
    };
  }

  const proxy = target.closest<HTMLElement>(RACK_NUMERIC_INPUT_PROXY_SELECTOR);
  const scope = proxy?.closest<HTMLElement>(RACK_NUMERIC_INPUT_SCOPE_SELECTOR);
  const proxyControl = proxy ? readRackControlTarget(proxy) : null;
  if (!proxy || !scope || !proxyControl) {
    return null;
  }

  const proxyInput = Array.from(
    scope.querySelectorAll<HTMLInputElement>(RACK_NUMERIC_INPUT_SELECTOR),
  ).find((candidate) => {
    const inputControl = readRackControlTarget(candidate);
    return inputControl !== null && controlsMatch(proxyControl, inputControl);
  }) ?? null;
  if (!proxyInput) {
    return null;
  }

  return {
    input: proxyInput,
    pointerElement: proxy,
  };
};

export const isRackNumericInput = (
  target: EventTarget | null,
): target is HTMLInputElement => (
  target instanceof HTMLInputElement
  && target.type === 'number'
  && readRackControlTarget(target) !== null
);
