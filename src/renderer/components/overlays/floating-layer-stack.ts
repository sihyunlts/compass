type FloatingLayerStackEntry = {
  id: string;
  parentId: string | null;
  order: number;
  containsEventTarget: (eventTarget: EventTarget | null) => boolean;
  onDismissRequest: () => void;
  onEscapeRequest?: () => void;
  onDescendantStateChange?: (hasActiveDescendant: boolean) => void;
  onStackOrderChange?: (stackOrder: number) => void;
};

type ActivateFloatingLayerInput = Omit<FloatingLayerStackEntry, 'order'>;

const activeFloatingLayers = new Map<string, FloatingLayerStackEntry>();
let nextFloatingLayerId = 1;
let nextFloatingLayerOrder = 1;
let isListeningForDismissKeys = false;

const handleDismissKeyDown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape') {
    return;
  }
  const topmost = resolveTopmostFloatingLayer();
  if (!topmost) {
    return;
  }
  (topmost.onEscapeRequest ?? topmost.onDismissRequest)();
  event.preventDefault();
  event.stopPropagation();
};

const syncDismissKeyListener = (): void => {
  const shouldListen = activeFloatingLayers.size > 0;
  if (shouldListen === isListeningForDismissKeys) {
    return;
  }
  isListeningForDismissKeys = shouldListen;
  if (shouldListen) {
    document.addEventListener('keydown', handleDismissKeyDown, true);
  } else {
    document.removeEventListener('keydown', handleDismissKeyDown, true);
  }
};

const hasAncestor = (entry: FloatingLayerStackEntry, ancestorId: string): boolean => {
  let parentId = entry.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    if (parentId === ancestorId) {
      return true;
    }
    visited.add(parentId);
    parentId = activeFloatingLayers.get(parentId)?.parentId ?? null;
  }
  return false;
};

const syncFloatingLayerState = (): void => {
  const orderedEntries = Array.from(activeFloatingLayers.values())
    .sort((left, right) => left.order - right.order);
  for (const [index, entry] of orderedEntries.entries()) {
    entry.onStackOrderChange?.(index + 1);
    entry.onDescendantStateChange?.(
      orderedEntries.some(
        (candidate) => candidate.id !== entry.id && hasAncestor(candidate, entry.id),
      ),
    );
  }
};

export const createFloatingLayerId = (prefix = 'floating-layer'): string =>
  `${prefix}-${nextFloatingLayerId++}`;

export const activateFloatingLayer = (input: ActivateFloatingLayerInput): void => {
  const parentId = input.parentId && activeFloatingLayers.has(input.parentId)
    ? input.parentId
    : null;
  const existingEntry = activeFloatingLayers.get(input.id);
  if (existingEntry) {
    activeFloatingLayers.set(input.id, {
      ...input,
      parentId,
      order: existingEntry.order,
    });
    syncFloatingLayerState();
    return;
  }
  if (parentId === null) {
    const unrelatedLayers = Array.from(activeFloatingLayers.values())
      .filter((entry) => entry.id !== input.id)
      .sort((left, right) => right.order - left.order);
    for (const entry of unrelatedLayers) {
      entry.onDismissRequest();
    }
  }
  activeFloatingLayers.set(input.id, {
    ...input,
    parentId,
    order: nextFloatingLayerOrder++,
  });
  syncDismissKeyListener();
  syncFloatingLayerState();
};

export const deactivateFloatingLayer = (id: string): void => {
  if (!activeFloatingLayers.delete(id)) {
    return;
  }
  syncDismissKeyListener();
  syncFloatingLayerState();
};

export const resolveFloatingLayerParentId = (
  eventTarget: EventTarget | null,
  excludeId?: string,
): string | null => Array.from(activeFloatingLayers.values())
  .filter((entry) => entry.id !== excludeId && entry.containsEventTarget(eventTarget))
  .sort((left, right) => right.order - left.order)[0]?.id ?? null;

export const hasActiveFloatingLayerDescendant = (id: string): boolean =>
  Array.from(activeFloatingLayers.values()).some(
    (entry) => entry.id !== id && hasAncestor(entry, id),
  );

export const isTopmostFloatingLayer = (id: string): boolean => {
  const activeEntry = activeFloatingLayers.get(id);
  if (!activeEntry) {
    return false;
  }
  for (const entry of activeFloatingLayers.values()) {
    if (entry.order > activeEntry.order) {
      return false;
    }
  }
  return true;
};

const resolveTopmostFloatingLayer = (): FloatingLayerStackEntry | null =>
  Array.from(activeFloatingLayers.values())
    .sort((left, right) => right.order - left.order)[0] ?? null;

export const dismissAllFloatingLayers = (): void => {
  const entries = Array.from(activeFloatingLayers.values())
    .sort((left, right) => right.order - left.order);
  activeFloatingLayers.clear();
  syncDismissKeyListener();
  for (const entry of entries) {
    entry.onDescendantStateChange?.(false);
    entry.onDismissRequest();
  }
};
