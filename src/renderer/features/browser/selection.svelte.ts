import {
  applyOrderedRangeSelection,
  getOrderedSelectedIds,
  hasAdditiveSelectionModifier,
  haveSameSelectedIds,
  reconcileOrderedSelection,
  selectSingleOrderedItem,
  toggleOrderedSelection,
  type OrderedSelectionUpdate,
} from '../selection/ordered-selection';

interface BrowserSelectionState {
  selectedRowIds: string[];
  anchorRowId: string | null;
}

class BrowserSelection {
  public readonly state: BrowserSelectionState = $state({
    selectedRowIds: [],
    anchorRowId: null,
  });

  public clear(): void {
    this.apply({
      selectedIds: [],
      anchorId: null,
    });
  }

  public mountClearOnOutsidePointer(rowSelector: string): () => void {
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (target instanceof Element && target.closest(rowSelector)) return;
      this.clear();
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
  }

  public includes(rowId: string): boolean {
    return this.state.selectedRowIds.includes(rowId);
  }

  public getOrderedSelectedRowIds(orderedRowIds: readonly string[]): string[] {
    return getOrderedSelectedIds(this.state.selectedRowIds, orderedRowIds);
  }

  public selectSingle(rowId: string, orderedRowIds: readonly string[]): void {
    this.apply(selectSingleOrderedItem(this.snapshot(), rowId, orderedRowIds));
  }

  public toggle(rowId: string, orderedRowIds: readonly string[]): void {
    this.apply(toggleOrderedSelection(this.snapshot(), rowId, orderedRowIds));
  }

  public selectRange(
    rowId: string,
    additiveSelection: boolean,
    orderedRowIds: readonly string[],
  ): void {
    this.apply(applyOrderedRangeSelection(
      this.snapshot(),
      rowId,
      additiveSelection,
      orderedRowIds,
    ));
  }

  public selectFromPointer(
    rowId: string,
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
    orderedRowIds: readonly string[],
  ): void {
    if (event.shiftKey) {
      this.selectRange(rowId, hasAdditiveSelectionModifier(event), orderedRowIds);
    } else if (hasAdditiveSelectionModifier(event)) {
      this.toggle(rowId, orderedRowIds);
    } else {
      this.selectSingle(rowId, orderedRowIds);
    }
  }

  public selectFromToggleKey(
    rowId: string,
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
    orderedRowIds: readonly string[],
  ): void {
    if (event.shiftKey) {
      this.selectRange(rowId, hasAdditiveSelectionModifier(event), orderedRowIds);
    } else {
      this.toggle(rowId, orderedRowIds);
    }
  }

  public selectFromFocusMove(
    rowId: string,
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
    orderedRowIds: readonly string[],
  ): void {
    if (event.shiftKey) {
      this.selectRange(rowId, hasAdditiveSelectionModifier(event), orderedRowIds);
    } else if (!hasAdditiveSelectionModifier(event)) {
      this.selectSingle(rowId, orderedRowIds);
    }
  }

  public replace(
    rowIds: readonly string[],
    orderedRowIds: readonly string[],
  ): void {
    const selectedIds = orderedRowIds.filter((rowId) =>
      rowIds.includes(rowId));
    this.apply({
      selectedIds,
      anchorId: selectedIds[selectedIds.length - 1] ?? null,
    });
  }

  public reconcile(orderedRowIds: readonly string[]): void {
    this.apply(reconcileOrderedSelection(this.snapshot(), orderedRowIds));
  }

  private snapshot() {
    return {
      selectedIds: this.state.selectedRowIds,
      anchorId: this.state.anchorRowId,
    };
  }

  private apply(update: OrderedSelectionUpdate): void {
    if (!haveSameSelectedIds(update.selectedIds, this.state.selectedRowIds)) {
      this.state.selectedRowIds = update.selectedIds;
    }

    if (update.anchorId !== this.state.anchorRowId) {
      this.state.anchorRowId = update.anchorId;
    }
  }
}

export const createBrowserSelection = (): BrowserSelection => new BrowserSelection();
