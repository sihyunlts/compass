import { clamp } from '../../../shared/math';
import type { BrowserInsertSource } from '../../components/rack/device-rack-types';
import type {
  ChainDragSourceKind,
  RackDropZone,
} from './drop-ops';
import { RackDropTargetResolver } from './drop-target-resolver';

/** Drag end result: dropZone may be null; shouldCommit gates reorder/insert persistence. */
type DragDropPointerUpResult =
  | {
      kind: 'chain';
      sourceIds: string[];
      sourceKind: ChainDragSourceKind;
      dropZone: RackDropZone | null;
      didMove: boolean;
      shouldCommit: boolean;
    }
  | {
      kind: 'browser';
      source: BrowserInsertSource;
      dropZone: RackDropZone | null;
      didMove: boolean;
      shouldCommit: boolean;
    };

/** Transient drag snapshot for rendering; do not persist this structure. */
export type ActiveDragInfo =
  | {
      kind: 'chain';
      sourceIds: string[];
      sourceKind: ChainDragSourceKind;
      didMove: boolean;
      dropZone: RackDropZone | null;
    }
  | {
      kind: 'browser';
      source: BrowserInsertSource;
      didMove: boolean;
      dropZone: RackDropZone | null;
    };

type RackDragControllerOptions = {
  chainDevices: HTMLElement;
  browserDragBadge: HTMLElement;
  isBlocked: () => boolean;
  closeContextMenu: () => void;
  onDragUpdate?: (info: ActiveDragInfo | null) => void;
};

// Minimum pointer travel before a drag is considered intentional.
const DRAG_START_THRESHOLD_PX = 4;

// Auto-scroll settings while dragging near rack edges.
const DRAG_AUTO_SCROLL_EDGE_PX = 56;
const DRAG_AUTO_SCROLL_MAX_STEP_PX = 8;

// Badge offset and viewport margin for browser-item drags.
const BROWSER_DRAG_BADGE_OFFSET_X = 16;
const BROWSER_DRAG_BADGE_OFFSET_Y = 16;
const BROWSER_DRAG_BADGE_MARGIN_PX = 8;

type ChainDragState = {
  kind: 'chain';
  pointerId: number;
  sourceIds: string[];
  sourceKind: ChainDragSourceKind;
  startX: number;
  startY: number;
  didMove: boolean;
  dropZone: RackDropZone | null;
};

type BrowserDragState = {
  kind: 'browser';
  pointerId: number;
  source: BrowserInsertSource;
  itemEl: HTMLElement;
  badgeLabel: string;
  startX: number;
  startY: number;
  didMove: boolean;
  dropZone: RackDropZone | null;
};

type ActiveDrag = ChainDragState | BrowserDragState;

const snapshotDropZone = (dropZone: RackDropZone | null): RackDropZone | null => {
  if (!dropZone) {
    return null;
  }

  if (dropZone.kind === 'inside-group') {
    return {
      kind: 'inside-group',
      groupId: dropZone.groupId,
      targetId: dropZone.targetId,
      placement: dropZone.placement,
    };
  }

  return {
    kind: 'outside',
    targetId: dropZone.targetId,
    placement: dropZone.placement,
  };
};

/** Handles drag/drop interactions for device reorder and browser insert actions. */
export class RackDragController {
  private readonly chainDevices: HTMLElement;
  private readonly browserDragBadge: HTMLElement;
  private readonly isBlocked: () => boolean;
  private readonly closeContextMenu: () => void;
  private readonly onDragUpdate?: (info: ActiveDragInfo | null) => void;
  private readonly dropTargetResolver: RackDropTargetResolver;

  private activeDrag: ActiveDrag | null = null;
  private lastPointerClientX = 0;
  private lastPointerClientY = 0;
  private autoScrollRafId: number | null = null;

  constructor(options: RackDragControllerOptions) {
    this.chainDevices = options.chainDevices;
    this.browserDragBadge = options.browserDragBadge;
    this.isBlocked = options.isBlocked;
    this.closeContextMenu = options.closeContextMenu;
    this.onDragUpdate = options.onDragUpdate;
    this.dropTargetResolver = new RackDropTargetResolver(options.chainDevices);
  }

  hasActivePointer(): boolean {
    return this.activeDrag !== null;
  }

  resolveExternalFileDropZone(
    clientX: number,
    clientY: number,
  ): RackDropZone | null {
    return this.dropTargetResolver.resolveExternalFileDropZone(clientX, clientY);
  }

  private getActiveDragInfoSnapshot(): ActiveDragInfo | null {
    const drag = this.activeDrag;
    if (!drag) {
      return null;
    }

    if (drag.kind === 'chain') {
      return {
        kind: 'chain',
        sourceIds: [...drag.sourceIds],
        sourceKind: drag.sourceKind,
        didMove: drag.didMove,
        dropZone: snapshotDropZone(drag.dropZone),
      };
    }

    return {
      kind: 'browser',
      source: drag.source,
      didMove: drag.didMove,
      dropZone: snapshotDropZone(drag.dropZone),
    };
  }

  private notifyDragUpdate(): void {
    this.onDragUpdate?.(this.getActiveDragInfoSnapshot());
  }

  startChainDrag(
    event: PointerEvent,
    sourceIds: readonly string[],
    sourceKind: ChainDragSourceKind = 'devices',
  ): boolean {
    if (sourceIds.length === 0 || !this.canStartDrag(event)) {
      return false;
    }

    this.closeContextMenu();
    this.activeDrag = {
      kind: 'chain',
      pointerId: event.pointerId,
      sourceIds: [...sourceIds],
      sourceKind,
      startX: event.clientX,
      startY: event.clientY,
      didMove: false,
      dropZone: null,
    };
    this.lastPointerClientX = event.clientX;
    this.lastPointerClientY = event.clientY;
    this.notifyDragUpdate();
    return true;
  }

  startBrowserDrag(
    event: PointerEvent,
    source: BrowserInsertSource,
    itemEl: HTMLElement,
    badgeLabel: string,
  ): boolean {
    if (!this.canStartDrag(event)) {
      return false;
    }

    this.activeDrag = {
      kind: 'browser',
      pointerId: event.pointerId,
      source,
      itemEl,
      badgeLabel,
      startX: event.clientX,
      startY: event.clientY,
      didMove: false,
      dropZone: null,
    };
    this.lastPointerClientX = event.clientX;
    this.lastPointerClientY = event.clientY;
    this.notifyDragUpdate();
    return true;
  }

  handlePointerMove(event: PointerEvent): boolean {
    const drag = this.activeDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return false;
    }

    this.lastPointerClientX = event.clientX;
    this.lastPointerClientY = event.clientY;

    if (!drag.didMove) {
      const dx = Math.abs(event.clientX - drag.startX);
      const dy = Math.abs(event.clientY - drag.startY);
      if (dx + dy < DRAG_START_THRESHOLD_PX) {
        return false;
      }
      this.markDragStarted(drag);
      this.ensureAutoScrollLoop();
    }

    if (drag.kind === 'chain') {
      this.updateChainDragPreview(drag, event.clientX, event.clientY);
    } else {
      this.updateBrowserDragBadge(drag, event.clientX, event.clientY);
      this.updateBrowserDragPreview(drag, event.clientX, event.clientY);
    }

    return true;
  }

  handlePointerUp(event: PointerEvent): DragDropPointerUpResult | null {
    const drag = this.activeDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return null;
    }

    const result = this.buildPointerUpResult(drag);
    this.clearDraggingState(drag);
    return result;
  }

  handlePointerCancel(event: PointerEvent): boolean {
    const drag = this.activeDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return false;
    }

    this.clearDraggingState(drag);
    return true;
  }

  private canStartDrag(event: PointerEvent): boolean {
    return event.button === 0
      && event.isPrimary
      && this.activeDrag === null
      && !this.isBlocked();
  }

  private markDragStarted(drag: ActiveDrag): void {
    drag.didMove = true;
    if (drag.kind === 'browser') {
      drag.itemEl.classList.add('is-dragging');
    }
    this.notifyDragUpdate();
  }

  private buildPointerUpResult(drag: ActiveDrag): DragDropPointerUpResult {
    if (drag.kind === 'chain') {
      const dropZone = drag.dropZone;
      return {
        kind: 'chain',
        sourceIds: [...drag.sourceIds],
        sourceKind: drag.sourceKind,
        dropZone,
        didMove: drag.didMove,
        shouldCommit: drag.didMove && dropZone !== null,
      };
    }

    const dropZone = drag.dropZone;
    return {
      kind: 'browser',
      source: drag.source,
      dropZone,
      didMove: drag.didMove,
      shouldCommit: drag.didMove && dropZone !== null,
    };
  }

  private clearDraggingState(drag: ActiveDrag): void {
    this.stopAutoScrollLoop();

    if (drag.kind === 'browser') {
      drag.itemEl.classList.remove('is-dragging');
      this.browserDragBadge.classList.remove('is-visible');
      this.browserDragBadge.hidden = true;
      this.browserDragBadge.textContent = '';
      this.browserDragBadge.style.removeProperty('transform');
    }

    this.activeDrag = null;
    this.closeContextMenu();
    this.notifyDragUpdate();
  }

  private ensureAutoScrollLoop(): void {
    if (this.autoScrollRafId !== null) {
      return;
    }

    const tick = (): void => {
      this.autoScrollRafId = null;
      const drag = this.activeDrag;
      if (!drag || !drag.didMove) {
        return;
      }

      const didScroll = this.autoScrollChainDevices(
        this.lastPointerClientX,
        this.lastPointerClientY,
      );
      if (didScroll) {
        if (drag.kind === 'chain') {
          this.updateChainDragPreview(drag, this.lastPointerClientX, this.lastPointerClientY);
        } else {
          this.updateBrowserDragPreview(drag, this.lastPointerClientX, this.lastPointerClientY);
        }
      }

      this.autoScrollRafId = window.requestAnimationFrame(tick);
    };

    this.autoScrollRafId = window.requestAnimationFrame(tick);
  }

  private stopAutoScrollLoop(): void {
    if (this.autoScrollRafId === null) {
      return;
    }
    window.cancelAnimationFrame(this.autoScrollRafId);
    this.autoScrollRafId = null;
  }

  private autoScrollChainDevices(clientX: number, clientY: number): boolean {
    const rect = this.chainDevices.getBoundingClientRect();
    const deltaX = this.resolveAutoScrollStep(clientX, rect.left, rect.right);
    const deltaY = this.resolveAutoScrollStep(clientY, rect.top, rect.bottom);

    let didScroll = false;

    if (deltaX !== 0) {
      const maxScrollLeft = Math.max(0, this.chainDevices.scrollWidth - this.chainDevices.clientWidth);
      if (maxScrollLeft > 0) {
        const nextLeft = clamp(this.chainDevices.scrollLeft + deltaX, 0, maxScrollLeft);
        if (Math.abs(nextLeft - this.chainDevices.scrollLeft) > 0.001) {
          this.chainDevices.scrollLeft = nextLeft;
          didScroll = true;
        }
      }
    }

    if (deltaY !== 0) {
      const maxScrollTop = Math.max(0, this.chainDevices.scrollHeight - this.chainDevices.clientHeight);
      if (maxScrollTop > 0) {
        const nextTop = clamp(this.chainDevices.scrollTop + deltaY, 0, maxScrollTop);
        if (Math.abs(nextTop - this.chainDevices.scrollTop) > 0.001) {
          this.chainDevices.scrollTop = nextTop;
          didScroll = true;
        }
      }
    }

    return didScroll;
  }

  private resolveAutoScrollStep(pointer: number, start: number, end: number): number {
    const startDistance = pointer - start;
    if (startDistance < DRAG_AUTO_SCROLL_EDGE_PX) {
      const ratio = clamp(
        (DRAG_AUTO_SCROLL_EDGE_PX - startDistance) / DRAG_AUTO_SCROLL_EDGE_PX,
        0,
        1,
      );
      return -Math.max(1, Math.round(ratio * DRAG_AUTO_SCROLL_MAX_STEP_PX));
    }

    const endDistance = end - pointer;
    if (endDistance < DRAG_AUTO_SCROLL_EDGE_PX) {
      const ratio = clamp(
        (DRAG_AUTO_SCROLL_EDGE_PX - endDistance) / DRAG_AUTO_SCROLL_EDGE_PX,
        0,
        1,
      );
      return Math.max(1, Math.round(ratio * DRAG_AUTO_SCROLL_MAX_STEP_PX));
    }

    return 0;
  }

  private updateChainDragPreview(drag: ChainDragState, clientX: number, clientY: number): void {
    drag.dropZone = this.dropTargetResolver.resolveChainDropZone({
      sourceIds: drag.sourceIds,
      sourceKind: drag.sourceKind,
      clientX,
      clientY,
      prevDropZone: drag.dropZone,
    });
    this.notifyDragUpdate();
  }

  private updateBrowserDragPreview(drag: BrowserDragState, clientX: number, clientY: number): void {
    drag.dropZone = this.dropTargetResolver.resolveChainDropZone({
      sourceIds: [],
      sourceKind: 'devices',
      clientX,
      clientY,
      prevDropZone: drag.dropZone,
    });
    this.notifyDragUpdate();
  }

  private updateBrowserDragBadge(drag: BrowserDragState, clientX: number, clientY: number): void {
    if (!drag.didMove || !drag.badgeLabel) {
      return;
    }

    this.browserDragBadge.textContent = drag.badgeLabel;
    this.browserDragBadge.hidden = false;
    this.browserDragBadge.classList.add('is-visible');

    const badgeWidth = this.browserDragBadge.offsetWidth;
    const badgeHeight = this.browserDragBadge.offsetHeight;
    const maxX = Math.max(
      BROWSER_DRAG_BADGE_MARGIN_PX,
      window.innerWidth - badgeWidth - BROWSER_DRAG_BADGE_MARGIN_PX,
    );
    const maxY = Math.max(
      BROWSER_DRAG_BADGE_MARGIN_PX,
      window.innerHeight - badgeHeight - BROWSER_DRAG_BADGE_MARGIN_PX,
    );
    const x = clamp(
      clientX + BROWSER_DRAG_BADGE_OFFSET_X,
      BROWSER_DRAG_BADGE_MARGIN_PX,
      maxX,
    );
    const y = clamp(
      clientY + BROWSER_DRAG_BADGE_OFFSET_Y,
      BROWSER_DRAG_BADGE_MARGIN_PX,
      maxY,
    );
    this.browserDragBadge.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }
}
