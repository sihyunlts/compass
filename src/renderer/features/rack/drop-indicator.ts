import type { RackDropZone } from './drop-ops';

type IndicatorLayout = {
  key: string;
  leftInScrollSpace: number;
};

const TOP_LEVEL_DROP_TARGET_SELECTOR = '.device-slot--solo, .device-group.is-rack';
const GROUP_DROP_TARGET_SELECTOR = '.device-group.is-rack';
const DEVICE_CARD_SELECTOR = '.device-card';

export class RackDropIndicator {
  private readonly chainDevices: HTMLElement;

  private readonly indicator: HTMLElement;

  private lastIndicatorKey: string | null = null;

  public constructor(options: {
    chainDevices: HTMLElement;
    indicator: HTMLElement;
  }) {
    this.chainDevices = options.chainDevices;
    this.indicator = options.indicator;
  }

  public sync(info: { didMove: boolean; dropZone: RackDropZone | null } | null): void {
    if (!info || !info.didMove || !info.dropZone) {
      this.clear();
      return;
    }

    const layout = info.dropZone.kind === 'outside'
      ? this.resolveOutsideIndicatorLayout(info.dropZone)
      : this.resolveInsideGroupIndicatorLayout(info.dropZone);

    if (!layout) {
      this.clear();
      return;
    }

    if (layout.key === this.lastIndicatorKey) {
      return;
    }

    this.indicator.style.left = `${layout.leftInScrollSpace}px`;
    this.indicator.hidden = false;
    this.lastIndicatorKey = layout.key;
  }

  public clear(): void {
    this.lastIndicatorKey = null;
    this.indicator.hidden = true;
    this.indicator.style.removeProperty('left');
  }

  private getTopLevelItems(): HTMLElement[] {
    return [...this.chainDevices.children].flatMap((node) =>
      node instanceof HTMLElement
      && (
        node.classList.contains('device-slot--solo')
        || (node.classList.contains('device-group') && node.classList.contains('is-rack'))
      )
        ? [node]
        : []);
  }

  private getGroupSlots(groupEl: HTMLElement): HTMLElement[] {
    const body = groupEl.querySelector<HTMLElement>('.device-group-body');
    if (!body) {
      return [];
    }
    return [...body.children].flatMap((node) =>
      node instanceof HTMLElement && node.classList.contains('device-slot') ? [node] : []);
  }

  private resolveInsertionClientX(
    items: readonly HTMLElement[],
    insertionIndex: number,
  ): number {
    if (items.length === 0) {
      return this.chainDevices.getBoundingClientRect().left;
    }

    if (insertionIndex <= 0) {
      return items[0].getBoundingClientRect().left;
    }

    if (insertionIndex >= items.length) {
      return items[items.length - 1].getBoundingClientRect().right;
    }

    const prevRect = items[insertionIndex - 1].getBoundingClientRect();
    const nextRect = items[insertionIndex].getBoundingClientRect();
    return (prevRect.right + nextRect.left) / 2;
  }

  private toScrollSpaceLeft(clientX: number): number {
    const containerRect = this.chainDevices.getBoundingClientRect();
    return clientX - containerRect.left + this.chainDevices.scrollLeft;
  }

  private resolveOutsideIndicatorLayout(
    dropZone: { targetId: string | null; placement: 'before' | 'after' },
  ): IndicatorLayout {
    const topLevelItems = this.getTopLevelItems();
    let insertionIndex = topLevelItems.length;

    if (dropZone.targetId) {
      const targetCard = this.chainDevices.querySelector<HTMLElement>(
        `${DEVICE_CARD_SELECTOR}[data-device-id="${CSS.escape(dropZone.targetId)}"]`,
      );
      const targetRoot = targetCard?.closest<HTMLElement>(TOP_LEVEL_DROP_TARGET_SELECTOR);
      const normalizedTargetRoot = targetRoot?.parentElement === this.chainDevices
        ? targetRoot
        : null;
      if (normalizedTargetRoot) {
        const targetIndex = topLevelItems.indexOf(normalizedTargetRoot);
        if (targetIndex >= 0) {
          insertionIndex = dropZone.placement === 'before'
            ? targetIndex
            : targetIndex + 1;
        }
      }
    }

    return {
      key: `outside|${insertionIndex}`,
      leftInScrollSpace: this.toScrollSpaceLeft(
        this.resolveInsertionClientX(topLevelItems, insertionIndex),
      ),
    };
  }

  private resolveInsideGroupIndicatorLayout(
    dropZone: { groupId: string; targetId: string; placement: 'before' | 'after' },
  ): IndicatorLayout | null {
    const groupEl = this.chainDevices.querySelector<HTMLElement>(
      `${GROUP_DROP_TARGET_SELECTOR}[data-group-id="${CSS.escape(dropZone.groupId)}"]`,
    );
    if (!groupEl) {
      return null;
    }

    const slots = this.getGroupSlots(groupEl);
    const targetCard = groupEl.querySelector<HTMLElement>(
      `${DEVICE_CARD_SELECTOR}[data-device-id="${CSS.escape(dropZone.targetId)}"]`,
    );
    const targetSlot = targetCard?.closest<HTMLElement>('.device-slot') ?? null;
    const slotIndex = targetSlot ? slots.indexOf(targetSlot) : -1;
    const baseIndex = slotIndex >= 0 ? slotIndex : slots.length;
    const insertionIndex = dropZone.placement === 'before'
      ? baseIndex
      : baseIndex + 1;

    return {
      key: `inside|${dropZone.groupId}|${insertionIndex}`,
      leftInScrollSpace: this.toScrollSpaceLeft(
        this.resolveInsertionClientX(slots, insertionIndex),
      ),
    };
  }
}
