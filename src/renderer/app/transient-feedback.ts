/** Temporarily replaces supporting text, then restores it by clearing the override. */
export class TransientFeedback {
  private timer: ReturnType<typeof setTimeout> | null = null;

  public constructor(private readonly setMessage: (message: string) => void) {}

  public show(message: string, autoClear = true): void {
    this.cancelTimer();
    this.setMessage(message);
    if (autoClear) {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.setMessage('');
      }, 2500);
    }
  }

  public clear(): void {
    this.cancelTimer();
    this.setMessage('');
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
