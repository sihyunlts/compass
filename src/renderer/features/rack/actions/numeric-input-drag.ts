interface NumericInputDragState {
  pointerId: number | null;
  inputEl: HTMLInputElement | null;
  lastPointerX: number;
  lastPointerY: number;
  didMove: boolean;
  dragRawValue: number;
  step: number;
  min: number | null;
  max: number | null;
  decimals: number;
  sensitivity: number;
  wrapMode: boolean;
  isPointerLocked: boolean;
}

interface NumericInputInteractionOptions {
  onResetInput: (target: EventTarget | null) => boolean;
}

const NUMERIC_RESET_DOUBLE_CLICK_WINDOW_MS = 400;

const createNumericInputDragState = (): NumericInputDragState => ({
  pointerId: null,
  inputEl: null,
  lastPointerX: 0,
  lastPointerY: 0,
  didMove: false,
  dragRawValue: 0,
  step: 1,
  min: null,
  max: null,
  decimals: 0,
  sensitivity: 1,
  wrapMode: false,
  isPointerLocked: false,
});

const isRackNumericInput = (target: EventTarget | null): target is HTMLInputElement =>
  target instanceof HTMLInputElement
  && target.type === 'number'
  && !!target.dataset.controlAction
  && !!target.dataset.deviceId;

export class NumericInputInteraction {
  private readonly onResetInput: (target: EventTarget | null) => boolean;

  private readonly dragState = createNumericInputDragState();

  private overwriteOnTypeInput: HTMLInputElement | null = null;

  private lastNumberClickInput: HTMLInputElement | null = null;

  private lastNumberClickAt = 0;

  constructor(options: NumericInputInteractionOptions) {
    this.onResetInput = options.onResetInput;
  }

  handleFocusIn(event: FocusEvent): void {
    const target = event.target;
    if (!isRackNumericInput(target) || target.disabled || target.readOnly) {
      return;
    }

    this.overwriteOnTypeInput = target;
    delete target.dataset.keyboardEditing;
  }

  handleKeyDown(event: KeyboardEvent): void {
    const target = event.target;
    if (!isRackNumericInput(target)) {
      return;
    }

    const isTypingKey = !(
      event.defaultPrevented
      || event.isComposing
      || event.ctrlKey
      || event.metaKey
      || event.altKey
      || event.key.length !== 1
      || !/[0-9+\-eE.]/.test(event.key)
    );
    if (!isTypingKey) {
      return;
    }

    target.dataset.keyboardEditing = 'true';
    if (this.overwriteOnTypeInput === target) {
      this.overwriteOnTypeInput = null;
      target.value = '';
    }
  }

  isActive(): boolean {
    return this.dragState.pointerId !== null;
  }

  isPointer(pointerId: number): boolean {
    return this.dragState.pointerId === pointerId;
  }

  tryStart(event: PointerEvent, target: HTMLElement): boolean {
    const input = target.closest<HTMLInputElement>(
      'input[type="number"][data-control-action][data-device-id]',
    );
    if (!input || input.disabled || input.readOnly) {
      return false;
    }

    const min = this.parseInputBound(input.min);
    const max = this.parseInputBound(input.max);
    const step = this.resolveNumberStep(input);
    const decimals = this.resolveStepDecimals(input);
    const currentValue = Number(input.value);
    const initialValue = Number.isFinite(currentValue) ? currentValue : (min ?? 0);
    const hasFiniteRange = min !== null && max !== null && max > min;
    const wrapMode = input.dataset.controlAction === 'set-angle-param' && hasFiniteRange;
    const sensitivity = hasFiniteRange ? Math.max((max - min) / 480, step) : step;

    this.dragState.pointerId = event.pointerId;
    this.dragState.inputEl = input;
    this.dragState.lastPointerX = event.clientX;
    this.dragState.lastPointerY = event.clientY;
    this.dragState.didMove = false;
    this.dragState.dragRawValue = initialValue;
    this.dragState.step = step;
    this.dragState.min = min;
    this.dragState.max = max;
    this.dragState.decimals = decimals;
    this.dragState.sensitivity = sensitivity;
    this.dragState.wrapMode = wrapMode;
    this.dragState.isPointerLocked = false;
    this.overwriteOnTypeInput = input;
    delete input.dataset.keyboardEditing;

    input.dataset.dragActive = 'true';
    input.focus();
    input.setPointerCapture(event.pointerId);
    if (event.pointerType === 'mouse') {
      this.requestPointerLock(input);
    }

    return true;
  }

  handlePointerMove(clientX: number, clientY: number): void {
    const input = this.dragState.inputEl;
    if (!input || this.dragState.isPointerLocked) {
      return;
    }

    const deltaY = this.dragState.lastPointerY - clientY;
    const deltaX = clientX - this.dragState.lastPointerX;
    this.dragState.lastPointerX = clientX;
    this.dragState.lastPointerY = clientY;
    this.applyDragDelta(deltaX, deltaY);
  }

  handleLockedMouseMove(event: MouseEvent): void {
    if (!this.isActive() || !this.dragState.isPointerLocked) {
      return;
    }

    this.applyDragDelta(event.movementX, -event.movementY);
  }

  handlePointerUp(at: number): void {
    const { inputEl, didMove } = this.dragState;
    this.clearDragState();

    if (!inputEl) {
      this.clearClickState();
      return;
    }

    if (didMove) {
      this.clearClickState();
      return;
    }

    const isDoubleClick = this.lastNumberClickInput === inputEl
      && at - this.lastNumberClickAt <= NUMERIC_RESET_DOUBLE_CLICK_WINDOW_MS;
    this.lastNumberClickInput = inputEl;
    this.lastNumberClickAt = at;

    if (!isDoubleClick) {
      return;
    }

    this.clearClickState();
    this.onResetInput(inputEl);
  }

  handlePointerCancel(): void {
    this.clearDragState();
    this.clearClickState();
  }

  handleWindowBlur(): void {
    if (this.isActive()) {
      this.clearDragState();
    }
    this.clearClickState();
  }

  handlePointerLockChange(): void {
    const input = this.dragState.inputEl;
    const wasPointerLocked = this.dragState.isPointerLocked;
    const isPointerLocked = !!input && document.pointerLockElement === input;
    this.dragState.isPointerLocked = isPointerLocked;

    if (wasPointerLocked && !isPointerLocked && this.isActive()) {
      this.clearDragState();
      this.clearClickState();
    }
  }

  finalizeFromMouseUp(at: number): void {
    if (!this.isActive()) {
      return;
    }

    this.handlePointerUp(at);
  }

  tryResetFromDoubleClick(target: EventTarget | null): boolean {
    return this.onResetInput(target);
  }

  private parseInputBound(rawValue: string): number | null {
    if (rawValue.trim() === '') {
      return null;
    }

    const parsed = Number(rawValue);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private resolveNumberStep(input: HTMLInputElement): number {
    const parsedStep = Number(input.step);
    return Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 1;
  }

  private resolveStepDecimals(input: HTMLInputElement): number {
    const stepText = input.step;
    if (!stepText || stepText === 'any') {
      return 0;
    }

    const dotIndex = stepText.indexOf('.');
    if (dotIndex < 0) {
      return 0;
    }

    return Math.max(0, stepText.length - dotIndex - 1);
  }

  private formatDraggedValue(value: number, decimals: number): string {
    return decimals > 0 ? value.toFixed(decimals) : String(Math.round(value));
  }

  private clampValue(value: number, min: number | null, max: number | null): number {
    let next = value;
    if (min !== null) {
      next = Math.max(next, min);
    }
    if (max !== null) {
      next = Math.min(next, max);
    }
    return next;
  }

  private requestPointerLock(input: HTMLInputElement): void {
    if (!('requestPointerLock' in input)) {
      return;
    }

    try {
      input.requestPointerLock();
    } catch {
      // Pointer lock is optional; drag still works without it.
    }
  }

  private exitPointerLock(input: HTMLInputElement | null): void {
    if (!input || document.pointerLockElement !== input) {
      return;
    }

    document.exitPointerLock();
  }

  private snapDraggedValue(rawValue: number): number {
    if (
      this.dragState.wrapMode
      && this.dragState.min !== null
      && this.dragState.max !== null
      && this.dragState.max > this.dragState.min
    ) {
      const range = this.dragState.max - this.dragState.min;
      const stepped =
        Math.round((rawValue - this.dragState.min) / this.dragState.step) * this.dragState.step
        + this.dragState.min;
      let wrapped = (stepped - this.dragState.min) % range;
      if (wrapped < 0) {
        wrapped += range;
      }

      return Number((this.dragState.min + wrapped).toFixed(this.dragState.decimals));
    }

    const base = this.dragState.min ?? 0;
    const stepped =
      Math.round((rawValue - base) / this.dragState.step) * this.dragState.step
      + base;
    const clamped = this.clampValue(stepped, this.dragState.min, this.dragState.max);
    return Number(clamped.toFixed(this.dragState.decimals));
  }

  private applyDragDelta(deltaX: number, deltaY: number): void {
    const input = this.dragState.inputEl;
    if (!input) {
      return;
    }

    if (deltaX !== 0 || deltaY !== 0) {
      this.dragState.didMove = true;
    }

    this.dragState.dragRawValue += (deltaY + deltaX * 0.5) * this.dragState.sensitivity;

    const nextValue = this.snapDraggedValue(this.dragState.dragRawValue);
    const nextText = this.formatDraggedValue(nextValue, this.dragState.decimals);
    if (input.value === nextText) {
      return;
    }

    input.value = nextText;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private clearClickState(): void {
    this.lastNumberClickInput = null;
    this.lastNumberClickAt = 0;
  }

  private clearDragState(): void {
    const { inputEl, pointerId } = this.dragState;
    if (inputEl && pointerId !== null && inputEl.hasPointerCapture(pointerId)) {
      inputEl.releasePointerCapture(pointerId);
    }

    this.exitPointerLock(inputEl);
    if (inputEl) {
      delete inputEl.dataset.dragActive;
    }

    Object.assign(this.dragState, createNumericInputDragState());
  }
}
