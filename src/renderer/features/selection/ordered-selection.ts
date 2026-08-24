interface OrderedSelectionState {
  selectedIds: readonly string[];
  anchorId: string | null;
}

export interface OrderedSelectionUpdate {
  selectedIds: string[];
  anchorId: string | null;
}

export const haveSameSelectedIds = (
  left: readonly string[],
  right: readonly string[],
): boolean =>
  left.length === right.length
  && left.every((id, index) => id === right[index]);

export const hasAdditiveSelectionModifier = (
  event: { metaKey: boolean; ctrlKey: boolean },
): boolean => event.metaKey || event.ctrlKey;

const dedupeIds = (ids: Iterable<string>): string[] => [...new Set(ids)];

const buildSelectionRange = (
  orderedIds: readonly string[],
  fromId: string,
  toId: string,
): string[] => {
  const fromIndex = orderedIds.indexOf(fromId);
  const toIndex = orderedIds.indexOf(toId);
  if (fromIndex < 0 || toIndex < 0) {
    return [toId];
  }

  const start = Math.min(fromIndex, toIndex);
  const end = Math.max(fromIndex, toIndex);
  return orderedIds.slice(start, end + 1);
};

export const getOrderedSelectedIds = (
  selectedIds: readonly string[],
  orderedIds: readonly string[],
): string[] => {
  const selectedIdSet = new Set(selectedIds);
  return orderedIds.filter((id) => selectedIdSet.has(id));
};

export const updateOrderedSelection = (
  current: OrderedSelectionState,
  ids: Iterable<string>,
  requestedAnchorId: string | null,
  orderedIds: readonly string[],
): OrderedSelectionUpdate => {
  const orderedIdSet = new Set(orderedIds);
  const selectedIds = dedupeIds(ids).filter((id) => orderedIdSet.has(id));
  const anchorId = requestedAnchorId && orderedIdSet.has(requestedAnchorId)
    ? requestedAnchorId
    : selectedIds.length === 0
      ? null
      : current.anchorId;

  return {
    selectedIds,
    anchorId,
  };
};

export const reconcileOrderedSelection = (
  current: OrderedSelectionState,
  orderedIds: readonly string[],
): OrderedSelectionUpdate => {
  const orderedIdSet = new Set(orderedIds);
  return {
    selectedIds: current.selectedIds.filter((id) => orderedIdSet.has(id)),
    anchorId: current.anchorId && orderedIdSet.has(current.anchorId)
      ? current.anchorId
      : null,
  };
};

export const applyOrderedRangeSelection = (
  current: OrderedSelectionState,
  targetId: string,
  additiveSelection: boolean,
  orderedIds: readonly string[],
): OrderedSelectionUpdate => {
  const anchorId = current.anchorId && orderedIds.includes(current.anchorId)
    ? current.anchorId
    : targetId;
  const rangeIds = buildSelectionRange(orderedIds, anchorId, targetId);

  return updateOrderedSelection(
    current,
    additiveSelection
      ? [...getOrderedSelectedIds(current.selectedIds, orderedIds), ...rangeIds]
      : rangeIds,
    anchorId,
    orderedIds,
  );
};

export const toggleOrderedSelection = (
  current: OrderedSelectionState,
  targetId: string,
  orderedIds: readonly string[],
): OrderedSelectionUpdate => {
  if (!orderedIds.includes(targetId)) {
    return reconcileOrderedSelection(current, orderedIds);
  }

  const selectedIds = getOrderedSelectedIds(current.selectedIds, orderedIds);
  const selectedIndex = selectedIds.indexOf(targetId);
  if (selectedIndex >= 0) {
    selectedIds.splice(selectedIndex, 1);
  } else {
    selectedIds.push(targetId);
  }

  return updateOrderedSelection(current, selectedIds, targetId, orderedIds);
};

export const selectSingleOrderedItem = (
  current: OrderedSelectionState,
  targetId: string,
  orderedIds: readonly string[],
): OrderedSelectionUpdate =>
  updateOrderedSelection(current, [targetId], targetId, orderedIds);
