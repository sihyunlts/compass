interface HeaderIndicatorSource {
  getText(): string;
  setText(text: string): void;
  clearText(): void;
}

interface HeaderIndicatorOptions {
  visibilityMs?: number;
  fadeOutMs?: number;
}

interface HeaderIndicatorShowOptions {
  autoClear?: boolean;
}

interface HeaderIndicatorState {
  displayText: string;
  isVisible: boolean;
}

const DEFAULT_VISIBILITY_MS = 2000;
const DEFAULT_FADE_OUT_MS = 1500;

export class HeaderIndicatorController {
  public readonly state: HeaderIndicatorState = $state({
    displayText: '',
    isVisible: false,
  });

  private visibilityTimer: number | null = null;

  private fadeOutTimer: number | null = null;

  public constructor(
    private readonly source: HeaderIndicatorSource,
    private readonly options: HeaderIndicatorOptions = {},
  ) {}

  public show(
    text: string,
    options: HeaderIndicatorShowOptions = {},
  ): void {
    this.source.setText(text);
    this.clearVisibilityTimer();
    if (options.autoClear === false) {
      return;
    }

    this.visibilityTimer = window.setTimeout(() => {
      this.visibilityTimer = null;
      if (this.source.getText() === text) {
        this.source.clearText();
      }
    }, this.options.visibilityMs ?? DEFAULT_VISIBILITY_MS);
  }

  public clear(): void {
    this.clearVisibilityTimer();
    this.source.clearText();
  }

  public syncFromSource(): void {
    const nextText = this.source.getText().trim();
    this.clearFadeOutTimer();

    if (nextText) {
      this.state.displayText = nextText;
      this.state.isVisible = true;
      return;
    }

    if (!this.state.displayText) {
      this.state.isVisible = false;
      return;
    }

    this.state.isVisible = false;
    this.fadeOutTimer = window.setTimeout(() => {
      this.fadeOutTimer = null;
      if (this.source.getText().trim() === '') {
        this.state.displayText = '';
      }
    }, this.options.fadeOutMs ?? DEFAULT_FADE_OUT_MS);
  }

  public dispose(): void {
    this.clearVisibilityTimer();
    this.clearFadeOutTimer();
  }

  private clearVisibilityTimer(): void {
    if (this.visibilityTimer === null) {
      return;
    }

    window.clearTimeout(this.visibilityTimer);
    this.visibilityTimer = null;
  }

  private clearFadeOutTimer(): void {
    if (this.fadeOutTimer === null) {
      return;
    }

    window.clearTimeout(this.fadeOutTimer);
    this.fadeOutTimer = null;
  }
}

export const createHeaderIndicator = (
  source: HeaderIndicatorSource,
  options?: HeaderIndicatorOptions,
): HeaderIndicatorController => new HeaderIndicatorController(source, options);
