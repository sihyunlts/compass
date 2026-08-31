export const releasePointerCaptureIfHeld = (
  element: HTMLElement | null,
  pointerId: number | null,
): void => {
  if (element && pointerId !== null && element.hasPointerCapture(pointerId)) {
    element.releasePointerCapture(pointerId);
  }
};

export class PointerCaptureSession<T extends HTMLElement> {
  private pointerId: number | null = null;

  private element: T | null = null;

  private didChange = false;

  public constructor(private readonly options: {
    onChanged: () => void;
    beforeRelease?: (element: T) => void;
    afterFinish?: () => void;
  }) {}

  public get target(): T | null {
    return this.element;
  }

  public isActive(): boolean {
    return this.pointerId !== null;
  }

  public matches(pointerId: number): boolean {
    return this.pointerId === pointerId;
  }

  public begin(element: T, pointerId: number): void {
    this.pointerId = pointerId;
    this.element = element;
    this.didChange = false;
    element.setPointerCapture(pointerId);
  }

  public markChanged(): void {
    this.didChange = true;
  }

  public finish(): void {
    if (this.element) {
      this.options.beforeRelease?.(this.element);
    }
    releasePointerCaptureIfHeld(this.element, this.pointerId);
    if (this.didChange) {
      this.options.onChanged();
    }

    this.pointerId = null;
    this.element = null;
    this.didChange = false;
    this.options.afterFinish?.();
  }

  public finishForPointer(pointerId: number): boolean {
    if (!this.matches(pointerId)) {
      return false;
    }

    this.finish();
    return true;
  }
}
