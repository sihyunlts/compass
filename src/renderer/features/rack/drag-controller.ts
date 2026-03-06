import type { BrowserDeviceKind } from '../../services/devices';
import { clamp } from '../../../shared/math';
import { normalizeOptionalId } from '../../../shared/normalize-id';
import type {
  ChainDragSourceKind,
  DropPlacement,
  RackDropZone,
} from './drop-ops';

/** Drag end result: dropZone may be null; shouldCommit gates reorder/insert persistence. */
export type DragDropPointerUpResult =
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
      sourceKind: BrowserDeviceKind;
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
      sourceKind: BrowserDeviceKind;
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

// Drop detection margin used while reordering chain devices.
const CHAIN_DROP_ZONE_MARGIN_X_PX = 256;
const CHAIN_DROP_ZONE_MARGIN_Y_PX = 64;

// Hysteresis used when entering/leaving inside-group drop zones.
const GROUP_INSIDE_ENTER_MARGIN_PX = 8;
const GROUP_INSIDE_EXIT_MARGIN_PX = 14;

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
  sourceKind: BrowserDeviceKind;
  itemEl: HTMLElement;
  badgeLabel: string;
  startX: number;
  startY: number;
  didMove: boolean;
  dropZone: RackDropZone | null;
};

type ActiveDrag = ChainDragState | BrowserDragState;

type DropPosition = {
  targetId: string | null;
  placement: DropPlacement;
};

type OutsideDropTarget = {
  firstId: string;
  lastId: string;
  left: number;
  right: number;
  centerX: number;
};

const TOP_LEVEL_DROP_TARGET_SELECTOR = '.device-slot--solo, .device-group.is-rack';
const DEVICE_CARD_SELECTOR = '.device-card[data-device-id]';

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
  }

  hasActivePointer(): boolean {
    return this.activeDrag !== null;
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
      sourceKind: drag.sourceKind,
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
    kind: BrowserDeviceKind,
    itemEl: HTMLElement,
    badgeLabel: string,
  ): boolean {
    if (!this.canStartDrag(event)) {
      return false;
    }

    this.activeDrag = {
      kind: 'browser',
      pointerId: event.pointerId,
      sourceKind: kind,
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
      sourceKind: drag.sourceKind,
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
    const prev = drag.dropZone;
    drag.dropZone = this.resolveDropZone(
      drag.sourceIds,
      drag.sourceKind,
      clientX,
      clientY,
      prev,
    );
    this.notifyDragUpdate();
  }

  private updateBrowserDragPreview(drag: BrowserDragState, clientX: number, clientY: number): void {
    const prev = drag.dropZone;
    drag.dropZone = this.resolveDropZone([], 'devices', clientX, clientY, prev);
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

  private resolveDropZone(
    sourceIds: readonly string[],
    sourceKind: ChainDragSourceKind,
    clientX: number,
    clientY: number,
    prevDropZone: RackDropZone | null,
  ): RackDropZone | null {
    const withMargin = sourceIds.length > 0;
    if (!this.isPointWithinChainDropZone(clientX, clientY, withMargin)) {
      return null;
    }

    const sourceSet = new Set(sourceIds);
    const rackGroup = this.resolvePointerRackGroup(clientX, clientY);
    const insideGroupContext = this.resolveInsideGroupContext(
      rackGroup,
      sourceKind,
      clientX,
      clientY,
      prevDropZone,
    );

    if (insideGroupContext) {
      const insidePosition = this.resolveDropPosition(insideGroupContext.bodyEl, sourceSet, clientX);
      if (!insidePosition.targetId) {
        return null;
      }

      const dropZone: RackDropZone = {
        kind: 'inside-group',
        groupId: insideGroupContext.groupId,
        targetId: insidePosition.targetId,
        placement: insidePosition.placement,
      };
      if (this.isChainDropNoop(sourceIds, sourceKind, dropZone)) {
        return null;
      }
      return dropZone;
    }

    const outsidePosition = this.resolveOutsideDropPosition(sourceSet, clientX);
    const dropZone: RackDropZone = {
      kind: 'outside',
      targetId: outsidePosition.targetId,
      placement: outsidePosition.placement,
    };
    if (this.isChainDropNoop(sourceIds, sourceKind, dropZone)) {
      return null;
    }
    return dropZone;
  }

  private resolveInsideGroupContext(
    rackGroup: HTMLElement | null,
    sourceKind: ChainDragSourceKind,
    clientX: number,
    clientY: number,
    prevDropZone: RackDropZone | null,
  ): { groupId: string; bodyEl: HTMLElement } | null {
    if (sourceKind === 'group') {
      return null;
    }

    if (prevDropZone?.kind === 'inside-group') {
      const prevGroupId = normalizeOptionalId(prevDropZone.groupId);
      if (prevGroupId) {
        const prevGroupEl = this.chainDevices.querySelector<HTMLElement>(
          `.device-group.is-rack[data-group-id="${prevGroupId}"]`,
        );
        const prevBodyEl = prevGroupEl?.querySelector<HTMLElement>('.device-group-body');
        if (prevBodyEl) {
          const prevRect = prevBodyEl.getBoundingClientRect();
          if (this.isPointInsideRectWithMargin(clientX, clientY, prevRect, GROUP_INSIDE_EXIT_MARGIN_PX)) {
            return { groupId: prevGroupId, bodyEl: prevBodyEl };
          }
        }
      }
    }

    if (!rackGroup) {
      return null;
    }

    const bodyEl = rackGroup.querySelector<HTMLElement>('.device-group-body');
    const groupId = normalizeOptionalId(rackGroup.dataset.groupId);
    if (!bodyEl || !groupId) {
      return null;
    }

    const rect = bodyEl.getBoundingClientRect();
    if (!this.isPointInsideRectWithMargin(clientX, clientY, rect, -GROUP_INSIDE_ENTER_MARGIN_PX)) {
      return null;
    }

    return { groupId, bodyEl };
  }

  private resolveDropPosition(
    scope: ParentNode,
    sourceSet: ReadonlySet<string>,
    clientX: number,
  ): DropPosition {
    const orderedCards = [...scope.querySelectorAll<HTMLElement>(DEVICE_CARD_SELECTOR)]
      .flatMap((card) => {
        const id = card.dataset.deviceId;
        if (!id || sourceSet.has(id)) {
          return [];
        }
        return [{ id, card }];
      });

    if (orderedCards.length === 0) {
      return { targetId: null, placement: 'after' };
    }

    for (const entry of orderedCards) {
      const rect = entry.card.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      if (clientX < centerX) {
        return { targetId: entry.id, placement: 'before' };
      }
    }

    const lastCard = orderedCards[orderedCards.length - 1];
    return {
      targetId: lastCard.id,
      placement: 'after',
    };
  }

  private resolveOutsideDropPosition(
    sourceSet: ReadonlySet<string>,
    clientX: number,
  ): DropPosition {
    const targets = this.resolveOutsideDropTargets(sourceSet);
    if (targets.length === 0) {
      return { targetId: null, placement: 'after' };
    }

    const first = targets[0];
    if (clientX < first.centerX) {
      return {
        targetId: first.firstId,
        placement: 'before',
      };
    }

    const last = targets[targets.length - 1];
    if (clientX > last.centerX) {
      return {
        targetId: last.lastId,
        placement: 'after',
      };
    }

    let bestTarget: OutsideDropTarget = first;
    let bestPlacement: DropPlacement = 'before';
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const target of targets) {
      const leftDistance = Math.abs(clientX - target.left);
      if (leftDistance < bestDistance) {
        bestDistance = leftDistance;
        bestTarget = target;
        bestPlacement = 'before';
      }

      const rightDistance = Math.abs(clientX - target.right);
      if (rightDistance < bestDistance) {
        bestDistance = rightDistance;
        bestTarget = target;
        bestPlacement = 'after';
      }
    }

    return {
      targetId: bestPlacement === 'before' ? bestTarget.firstId : bestTarget.lastId,
      placement: bestPlacement,
    };
  }

  private resolveOutsideDropTargets(sourceSet: ReadonlySet<string>): OutsideDropTarget[] {
    const topLevelTargets = [...this.chainDevices.querySelectorAll<HTMLElement>(TOP_LEVEL_DROP_TARGET_SELECTOR)]
      .filter((el) => el.parentElement === this.chainDevices);

    return topLevelTargets.flatMap((targetEl) => {
      const targetIds = [...targetEl.querySelectorAll<HTMLElement>(DEVICE_CARD_SELECTOR)]
        .flatMap((card) => {
          const id = card.dataset.deviceId;
          if (!id || sourceSet.has(id)) {
            return [];
          }
          return [id];
        });

      if (targetIds.length === 0) {
        return [];
      }

      const rect = targetEl.getBoundingClientRect();
      return [{
        firstId: targetIds[0],
        lastId: targetIds[targetIds.length - 1],
        left: rect.left,
        right: rect.right,
        centerX: rect.left + rect.width / 2,
      }];
    });
  }

  private isChainDropNoop(
    sourceIds: readonly string[],
    sourceKind: ChainDragSourceKind,
    dropZone: RackDropZone,
  ): boolean {
    if (sourceIds.length === 0) {
      return false;
    }

    const sourceSet = new Set(sourceIds);
    const orderedIds = [...this.chainDevices.querySelectorAll<HTMLElement>(DEVICE_CARD_SELECTOR)]
      .flatMap((card) => {
        const id = card.dataset.deviceId;
        return id ? [id] : [];
      });
    const movedIds = orderedIds.filter((id) => sourceSet.has(id));
    if (movedIds.length === 0) {
      return true;
    }

    const remainingIds = orderedIds.filter((id) => !sourceSet.has(id));
    const insertIndex = this.resolveInsertIndex(
      remainingIds,
      dropZone.targetId,
      dropZone.placement,
    );
    const nextOrder = [...remainingIds];
    nextOrder.splice(insertIndex, 0, ...movedIds);

    if (!this.isSameOrder(nextOrder, orderedIds)) {
      return false;
    }

    if (sourceKind !== 'devices') {
      return true;
    }

    const nextGroupId = dropZone.kind === 'inside-group'
      ? normalizeOptionalId(dropZone.groupId)
      : null;
    for (const sourceId of movedIds) {
      const currentGroupId = normalizeOptionalId(
        this.getCardElement(sourceId)
          ?.closest<HTMLElement>('.device-group.is-rack')
          ?.dataset.groupId,
      );
      if (currentGroupId !== nextGroupId) {
        return false;
      }
    }

    return true;
  }

  private resolveInsertIndex(
    orderedIds: readonly string[],
    targetId: string | null,
    placement: DropPlacement,
  ): number {
    if (!targetId) {
      return orderedIds.length;
    }

    const targetIndex = orderedIds.indexOf(targetId);
    if (targetIndex < 0) {
      return orderedIds.length;
    }

    return placement === 'after' ? targetIndex + 1 : targetIndex;
  }

  private isSameOrder(left: readonly string[], right: readonly string[]): boolean {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index]) {
        return false;
      }
    }

    return true;
  }

  private resolvePointerRackGroup(clientX: number, clientY: number): HTMLElement | null {
    const pointerElement = document.elementFromPoint(clientX, clientY);
    if (!(pointerElement instanceof HTMLElement)) {
      return null;
    }

    return pointerElement.closest<HTMLElement>('.device-group.is-rack') ?? null;
  }

  private isPointInsideRectWithMargin(
    clientX: number,
    clientY: number,
    rect: DOMRect,
    margin: number,
  ): boolean {
    const left = rect.left - margin;
    const right = rect.right + margin;
    const top = rect.top - margin;
    const bottom = rect.bottom + margin;

    if (right < left || bottom < top) {
      return false;
    }

    return (
      clientX >= left
      && clientX <= right
      && clientY >= top
      && clientY <= bottom
    );
  }

  // Uses margin only for chain reorder drags to keep insertion stable near edges.
  private isPointWithinChainDropZone(
    clientX: number,
    clientY: number,
    withMargin: boolean,
  ): boolean {
    const rect = this.chainDevices.getBoundingClientRect();
    const marginX = withMargin ? CHAIN_DROP_ZONE_MARGIN_X_PX : 0;
    const marginY = withMargin ? CHAIN_DROP_ZONE_MARGIN_Y_PX : 0;
    const left = rect.left - marginX;
    const right = rect.right + marginX;
    const top = rect.top - marginY;
    const bottom = rect.bottom + marginY;

    return (
      clientX >= left
      && clientX <= right
      && clientY >= top
      && clientY <= bottom
    );
  }

  private getCardElement(id: string): HTMLElement | null {
    return this.chainDevices.querySelector<HTMLElement>(`.device-card[data-device-id="${id}"]`);
  }
}
