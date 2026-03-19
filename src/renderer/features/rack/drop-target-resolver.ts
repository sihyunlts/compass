import { normalizeOptionalId } from '../../../shared/normalize-id';
import type { RackPresetDropTargets } from '../../components/device-rack-types';
import type {
  ChainDragSourceKind,
  DropPlacement,
  RackDropZone,
} from './drop-ops';

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

type ResolveChainDropZoneOptions = {
  sourceIds: readonly string[];
  sourceKind: ChainDragSourceKind;
  clientX: number;
  clientY: number;
  prevDropZone: RackDropZone | null;
};

const CHAIN_DROP_ZONE_MARGIN_X_PX = 256;
const CHAIN_DROP_ZONE_MARGIN_Y_PX = 64;
const GROUP_INSIDE_ENTER_MARGIN_PX = 8;
const GROUP_INSIDE_EXIT_MARGIN_PX = 14;
const TOP_LEVEL_DROP_TARGET_SELECTOR = '.device-slot--solo, .device-group.is-rack';
const DEVICE_CARD_SELECTOR = '.device-card[data-device-id]';
const GROUP_SELECTOR = '.device-group.is-rack[data-group-id]';

/** Resolves rack insertion targets and replacement candidates for drag/drop operations. */
export class RackDropTargetResolver {
  private readonly chainDevices: HTMLElement;

  public constructor(chainDevices: HTMLElement) {
    this.chainDevices = chainDevices;
  }

  public resolveChainDropZone(
    options: ResolveChainDropZoneOptions,
  ): RackDropZone | null {
    const withMargin = options.sourceIds.length > 0;
    if (!this.isPointWithinChainDropZone(options.clientX, options.clientY, withMargin)) {
      return null;
    }

    const sourceSet = new Set(options.sourceIds);
    const rackGroup = this.resolvePointerRackGroup(options.clientX, options.clientY);
    const insideGroupContext = this.resolveInsideGroupContext(
      rackGroup,
      options.sourceKind,
      options.clientX,
      options.clientY,
      options.prevDropZone,
    );

    if (insideGroupContext) {
      const insidePosition = this.resolveDropPosition(
        insideGroupContext.bodyEl,
        sourceSet,
        options.clientX,
      );
      if (!insidePosition.targetId) {
        return null;
      }

      const dropZone: RackDropZone = {
        kind: 'inside-group',
        groupId: insideGroupContext.groupId,
        targetId: insidePosition.targetId,
        placement: insidePosition.placement,
      };
      if (this.isChainDropNoop(options.sourceIds, options.sourceKind, dropZone)) {
        return null;
      }
      return dropZone;
    }

    const outsidePosition = this.resolveOutsideDropPosition(sourceSet, options.clientX);
    const dropZone: RackDropZone = {
      kind: 'outside',
      targetId: outsidePosition.targetId,
      placement: outsidePosition.placement,
    };
    if (this.isChainDropNoop(options.sourceIds, options.sourceKind, dropZone)) {
      return null;
    }
    return dropZone;
  }

  public resolveExternalFileDropTargets(
    clientX: number,
    clientY: number,
  ): RackPresetDropTargets {
    if (!this.isPointWithinChainDropZone(clientX, clientY, false)) {
      return {
        dropZone: null,
        hoveredGroupId: null,
      };
    }

    return {
      dropZone: this.resolveChainDropZone({
        sourceIds: [],
        sourceKind: 'devices',
        clientX,
        clientY,
        prevDropZone: null,
      }),
      hoveredGroupId: this.resolveHoveredGroupId(clientX, clientY),
    };
  }

  private resolveHoveredGroupId(
    clientX: number,
    clientY: number,
  ): string | null {
    const pointerElement = document.elementFromPoint(clientX, clientY);
    if (!(pointerElement instanceof HTMLElement)) {
      return null;
    }

    return pointerElement.closest<HTMLElement>(GROUP_SELECTOR)?.dataset.groupId ?? null;
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
          `${GROUP_SELECTOR.replace(
            '[data-group-id]',
            `[data-group-id="${CSS.escape(prevGroupId)}"]`,
          )}`,
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

  private resolveOutsideDropTargets(
    sourceSet: ReadonlySet<string>,
  ): OutsideDropTarget[] {
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
          ?.closest<HTMLElement>(GROUP_SELECTOR)
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

  private isSameOrder(
    left: readonly string[],
    right: readonly string[],
  ): boolean {
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

  private resolvePointerRackGroup(
    clientX: number,
    clientY: number,
  ): HTMLElement | null {
    const pointerElement = document.elementFromPoint(clientX, clientY);
    if (!(pointerElement instanceof HTMLElement)) {
      return null;
    }

    return pointerElement.closest<HTMLElement>(GROUP_SELECTOR);
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
    return this.chainDevices.querySelector<HTMLElement>(
      `.device-card[data-device-id="${CSS.escape(id)}"]`,
    );
  }
}
