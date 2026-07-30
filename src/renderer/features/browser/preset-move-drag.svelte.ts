import {
  type PresetEntryMoveDestination,
} from '../../../shared/preset-entry-move';
import { arePresetPathsEqual } from '../../../shared/preset-entry-selection';
import type { PresetEntryContextTarget } from '../context-menu/types';
import { DragAutoScroller } from '../drag-auto-scroll';
import {
  hideBrowserDragBadge,
  showBrowserDragBadge,
  type BrowserDragBadgeContent,
} from './drag-badge';

export interface BrowserPresetMoveDestination
  extends PresetEntryMoveDestination {
  relativePath: string[];
  rowId: string | null;
}

interface ActiveBrowserPresetMove {
  pointerId: number;
  startX: number;
  startY: number;
  didMove: boolean;
  badge: BrowserDragBadgeContent;
  entries: PresetEntryContextTarget[];
  sourceRowIds: string[];
}

interface BrowserPresetMoveDragOptions {
  resolveDestination: (
    clientX: number,
    clientY: number,
    entries: readonly PresetEntryContextTarget[],
  ) => BrowserPresetMoveDestination | null;
  getDragBadge: () => HTMLElement | null;
  getScrollContainer: () => HTMLElement | null;
  expandDestination: (rowId: string) => void;
  onMove: (
    entries: readonly PresetEntryContextTarget[],
    destination: BrowserPresetMoveDestination,
  ) => void | Promise<void>;
}

const START_THRESHOLD_PX = 4;
const EXPAND_DELAY_MS = 600;
const SCROLL_EDGE_PX = 36;
const SCROLL_MAX_STEP_PX = 8;

/** Owns the pointer lifecycle and transient UI state for preset tree moves. */
export class BrowserPresetMoveDrag {
  public active = $state<ActiveBrowserPresetMove | null>(null);

  public destination = $state<BrowserPresetMoveDestination | null>(null);

  private readonly options: BrowserPresetMoveDragOptions;

  private expandTimer: number | null = null;

  private activeAbortController: AbortController | null = null;

  private readonly autoScroller: DragAutoScroller;

  private suppressClick = false;

  public constructor(options: BrowserPresetMoveDragOptions) {
    this.options = options;
    this.autoScroller = new DragAutoScroller({
      getContainer: options.getScrollContainer,
      edgePx: SCROLL_EDGE_PX,
      maxStepPx: SCROLL_MAX_STEP_PX,
      axes: 'vertical',
      onScroll: (clientX, clientY) => {
        const drag = this.active;
        if (drag?.didMove) {
          this.setDestination(
            options.resolveDestination(clientX, clientY, drag.entries),
          );
        }
      },
    });
  }

  public mount(): () => void {
    window.addEventListener('pointermove', this.handlePointerMove);
    window.addEventListener('pointerup', this.handlePointerUp);
    window.addEventListener('pointercancel', this.handlePointerCancel);
    window.addEventListener('blur', this.clear);

    return () => {
      window.removeEventListener('pointermove', this.handlePointerMove);
      window.removeEventListener('pointerup', this.handlePointerUp);
      window.removeEventListener('pointercancel', this.handlePointerCancel);
      window.removeEventListener('blur', this.clear);
      this.clear();
    };
  }

  public begin(
    entries: PresetEntryContextTarget[],
    sourceRowIds: string[],
    badge: BrowserDragBadgeContent,
    event: PointerEvent,
  ): AbortSignal | null {
    if (entries.length === 0 || this.active) {
      return null;
    }

    this.activeAbortController = new AbortController();
    this.active = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      didMove: false,
      badge,
      entries,
      sourceRowIds,
    };
    return this.activeAbortController.signal;
  }

  public consumeSuppressedClick(): boolean {
    const suppressClick = this.suppressClick;
    this.suppressClick = false;
    return suppressClick;
  }

  private readonly handlePointerMove = (event: PointerEvent): void => {
    const drag = this.active;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    if (!drag.didMove) {
      const distance =
        Math.abs(event.clientX - drag.startX)
        + Math.abs(event.clientY - drag.startY);
      if (distance < START_THRESHOLD_PX) {
        return;
      }
      drag.didMove = true;
      document.documentElement.classList.add('is-browser-preset-moving');
    }

    event.preventDefault();
    const dragBadge = this.options.getDragBadge();
    if (dragBadge) {
      showBrowserDragBadge(
        dragBadge,
        drag.badge,
        event.clientX,
        event.clientY,
      );
    }
    this.setDestination(
      this.options.resolveDestination(
        event.clientX,
        event.clientY,
        drag.entries,
      ),
    );
    this.autoScroller.updatePointer(event.clientX, event.clientY);
  };

  private readonly handlePointerUp = (event: PointerEvent): void => {
    const drag = this.active;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const destination = drag.didMove
      ? this.options.resolveDestination(
          event.clientX,
          event.clientY,
          drag.entries,
        )
      : null;
    if (drag.didMove) {
      this.suppressClick = true;
      window.setTimeout(() => { this.suppressClick = false; }, 0);
    }
    if (drag.didMove && destination?.rowId) {
      this.options.expandDestination(destination.rowId);
    }
    this.clear();
    if (drag.didMove && destination) {
      void this.options.onMove(drag.entries, destination);
    }
  };

  private readonly handlePointerCancel = (event: PointerEvent): void => {
    if (this.active?.pointerId === event.pointerId) {
      this.clear();
    }
  };

  private readonly clear = (): void => {
    this.clearExpandTimer();
    this.autoScroller.stop();
    this.activeAbortController?.abort();
    this.activeAbortController = null;
    this.active = null;
    this.destination = null;
    document.documentElement.classList.remove('is-browser-preset-moving');
    const dragBadge = this.options.getDragBadge();
    if (dragBadge) {
      hideBrowserDragBadge(dragBadge);
    }
  };

  private setDestination(
    destination: BrowserPresetMoveDestination | null,
  ): void {
    if (
      this.destination?.presetType === destination?.presetType
      && this.destination?.rowId === destination?.rowId
      && arePresetPathsEqual(
        this.destination?.relativePath ?? [],
        destination?.relativePath ?? [],
      )
    ) {
      return;
    }

    this.destination = destination;
    this.clearExpandTimer();
    if (!destination?.rowId) {
      return;
    }

    const rowId = destination.rowId;
    this.expandTimer = window.setTimeout(() => {
      this.expandTimer = null;
      if (this.destination?.rowId === rowId) {
        this.options.expandDestination(rowId);
      }
    }, EXPAND_DELAY_MS);
  }

  private clearExpandTimer(): void {
    if (this.expandTimer !== null) {
      window.clearTimeout(this.expandTimer);
      this.expandTimer = null;
    }
  }

}
