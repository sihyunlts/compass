const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'range',
  'button',
  'submit',
  'reset',
]);

export const isTextEditingElement = (element: Element | null): boolean => {
  if (!element) {
    return false;
  }

  if (
    element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
    || (element instanceof HTMLElement && element.isContentEditable)
  ) {
    return true;
  }

  if (element instanceof HTMLInputElement) {
    const type = element.type.toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }

  return false;
};

export const blurIfTextEditingElement = (element: Element | null): boolean => {
  if (!isTextEditingElement(element)) {
    return false;
  }

  if (element instanceof HTMLElement) {
    element.blur();
    return true;
  }

  return false;
};
