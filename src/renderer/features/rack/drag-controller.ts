import {
  getDeviceBrowserCategory,
  getDeviceBrowserIcon,
} from '../../../devices/browser-categories';
import type { GeneratorDeviceNode } from '../../../shared/model';
import { DragAutoScroller } from '../drag-auto-scroll';
import {
  hideBrowserDragBadge,
  showBrowserDragBadge,
  type BrowserDragBadgeContent,
} from '../browser/drag-badge';
import type { BrowserInsertSource } from './types';
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
  getDevices: () => readonly GeneratorDeviceNode[];
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
  badge: BrowserDragBadgeContent;
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

const resolveBrowserDragBadgeContent = (
  source: BrowserInsertSource,
  label: string,
): BrowserDragBadgeContent => {
  if (source.kind === 'device-kinds') {
    return { icon: 'select_all', iconStyle: '', label };
  }
  if (source.kind === 'group-preset') {
    return { icon: 'combine_columns', iconStyle: '', label };
  }
  if (source.kind === 'rack-preset') {
    return { icon: 'view_week', iconStyle: '', label };
  }
  const deviceKind = source.kind === 'device-kind'
    ? source.deviceKind
    : source.preset.device.kind;
  return {
    icon: getDeviceBrowserIcon(deviceKind),
    iconStyle:
      `--browser-icon-accent:var(${getDeviceBrowserCategory(deviceKind).accentColorVar});`,
    label,
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
  private readonly autoScroller: DragAutoScroller;

  private activeDrag: ActiveDrag | null = null;

  constructor(options: RackDragControllerOptions) {
    this.chainDevices = options.chainDevices;
    this.browserDragBadge = options.browserDragBadge;
    this.isBlocked = options.isBlocked;
    this.closeContextMenu = options.closeContextMenu;
    this.onDragUpdate = options.onDragUpdate;
    this.dropTargetResolver = new RackDropTargetResolver({
      chainDevices: options.chainDevices,
      getDevices: options.getDevices,
    });
    this.autoScroller = new DragAutoScroller({
      getContainer: () => this.chainDevices,
      edgePx: DRAG_AUTO_SCROLL_EDGE_PX,
      maxStepPx: DRAG_AUTO_SCROLL_MAX_STEP_PX,
      axes: 'both',
      onScroll: (clientX, clientY) => {
        const drag = this.activeDrag;
        if (drag?.kind === 'chain') {
          this.updateChainDragPreview(drag, clientX, clientY);
        } else if (drag?.kind === 'browser') {
          this.updateBrowserDragPreview(drag, clientX, clientY);
        }
      },
    });
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
      badge: resolveBrowserDragBadgeContent(source, badgeLabel),
      startX: event.clientX,
      startY: event.clientY,
      didMove: false,
      dropZone: null,
    };
    this.notifyDragUpdate();
    return true;
  }

  handlePointerMove(event: PointerEvent): boolean {
    const drag = this.activeDrag;
    if (!drag || drag.pointerId !== event.pointerId) {
      return false;
    }

    if (!drag.didMove) {
      const dx = Math.abs(event.clientX - drag.startX);
      const dy = Math.abs(event.clientY - drag.startY);
      if (dx + dy < DRAG_START_THRESHOLD_PX) {
        return false;
      }
      this.markDragStarted(drag);
    }

    if (drag.kind === 'chain') {
      this.updateChainDragPreview(drag, event.clientX, event.clientY);
    } else {
      this.updateBrowserDragBadge(drag, event.clientX, event.clientY);
      this.updateBrowserDragPreview(drag, event.clientX, event.clientY);
    }
    this.autoScroller.updatePointer(event.clientX, event.clientY);

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

  cancel(): void {
    if (this.activeDrag) {
      this.clearDraggingState(this.activeDrag);
    }
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
    this.autoScroller.stop();

    if (drag.kind === 'browser') {
      drag.itemEl.classList.remove('is-dragging');
      hideBrowserDragBadge(this.browserDragBadge);
    }

    this.activeDrag = null;
    this.closeContextMenu();
    this.notifyDragUpdate();
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
    if (
      !drag.didMove
      || document.documentElement.classList.contains(
        'is-browser-preset-moving',
      )
    ) {
      return;
    }

    showBrowserDragBadge(
      this.browserDragBadge,
      drag.badge,
      clientX,
      clientY,
    );
  }
}
