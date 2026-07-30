import { clamp } from '../../shared/math';

interface DragAutoScrollOptions {
  getContainer: () => HTMLElement | null;
  edgePx: number;
  maxStepPx: number;
  axes: 'both' | 'vertical';
  onScroll?: (clientX: number, clientY: number) => void;
}

/** Continuously scrolls a drag surface while the pointer stays near its edge. */
export class DragAutoScroller {
  private frameId: number | null = null;

  private clientX = 0;

  private clientY = 0;

  public constructor(private readonly options: DragAutoScrollOptions) {}

  public updatePointer(clientX: number, clientY: number): void {
    this.clientX = clientX;
    this.clientY = clientY;
    this.frameId ??= window.requestAnimationFrame(this.tick);
  }

  public stop(): void {
    if (this.frameId !== null) {
      window.cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  private readonly tick = (): void => {
    this.frameId = null;
    const container = this.options.getContainer();
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    const deltaX = this.options.axes === 'both'
      ? this.resolveStep(this.clientX, rect.left, rect.right)
      : 0;
    const deltaY = this.resolveStep(this.clientY, rect.top, rect.bottom);
    if (deltaX === 0 && deltaY === 0) {
      return;
    }

    const previousLeft = container.scrollLeft;
    const previousTop = container.scrollTop;
    container.scrollLeft = clamp(
      previousLeft + deltaX,
      0,
      Math.max(0, container.scrollWidth - container.clientWidth),
    );
    container.scrollTop = clamp(
      previousTop + deltaY,
      0,
      Math.max(0, container.scrollHeight - container.clientHeight),
    );
    if (
      container.scrollLeft === previousLeft
      && container.scrollTop === previousTop
    ) {
      return;
    }

    this.options.onScroll?.(this.clientX, this.clientY);
    this.frameId = window.requestAnimationFrame(this.tick);
  };

  private resolveStep(pointer: number, start: number, end: number): number {
    const startDistance = pointer - start;
    const endDistance = end - pointer;
    const direction = startDistance < this.options.edgePx
      ? -1
      : endDistance < this.options.edgePx
        ? 1
        : 0;
    if (direction === 0) {
      return 0;
    }

    const distance = direction < 0 ? startDistance : endDistance;
    const ratio = clamp(
      (this.options.edgePx - distance) / this.options.edgePx,
      0,
      1,
    );
    return direction * Math.max(
      1,
      Math.round(ratio * this.options.maxStepPx),
    );
  }
}
