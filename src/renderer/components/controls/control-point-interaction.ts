import { PointerCaptureSession } from '../../features/rack/pointer-capture-session';
import { performHapticFeedback } from '../../haptics';

/** Pointer ownership and window subscriptions shared by point editors. */
export class ControlPointPointerSession {
  private readonly capture = new PointerCaptureSession<Element>({ onChanged: () => {} });

  public canBegin(event: PointerEvent): boolean {
    return event.isPrimary && event.button === 0 && !this.capture.isActive();
  }

  public begin(element: Element, event: PointerEvent): void {
    this.capture.begin(element, event.pointerId);
  }

  public finish(): void {
    this.capture.finish();
  }

  public listen(handlers: {
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: () => void;
    outsidePress: (event: PointerEvent) => void;
  }): () => void {
    const move = (event: PointerEvent): void => {
      if (this.capture.matches(event.pointerId)) handlers.move(event);
    };
    const up = (event: PointerEvent): void => {
      if (this.capture.matches(event.pointerId)) handlers.up(event);
    };
    const cancel = (event: PointerEvent): void => {
      if (this.capture.matches(event.pointerId)) handlers.cancel();
    };
    window.addEventListener('pointerdown', handlers.outsidePress, true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('blur', handlers.cancel);
    return () => {
      window.removeEventListener('pointerdown', handlers.outsidePress, true);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', handlers.cancel);
      this.finish();
    };
  }
}

/** Establish the drag's initial snap silently, then notify when entering another snap. */
export class ControlPointSnapFeedback {
  private previousSignature: string | null = null;
  private hasInitialSample = false;

  public reset(): void {
    this.previousSignature = null;
    this.hasInitialSample = false;
  }

  public update(signature: string | null): void {
    if (this.hasInitialSample && signature !== null && signature !== this.previousSignature) {
      performHapticFeedback('alignment');
    }
    this.previousSignature = signature;
    this.hasInitialSample = true;
  }
}
