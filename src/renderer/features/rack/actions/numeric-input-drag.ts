import {
  closestRackNumericInputTarget,
  isRackNumericInput,
} from '../control-target';

interface NumericInputDragState {
  pointerId: number | null;
  inputEl: HTMLInputElement | null;
  pointerEl: HTMLElement | null;
  lastPointerX: number;
  lastPointerY: number;
  didMove: boolean;
  didChange: boolean;
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
const SHIFT_DRAG_SENSITIVITY_MULTIPLIER = 0.25;

const createNumericInputDragState = (): NumericInputDragState => ({
  pointerId: null,
  inputEl: null,
  pointerEl: null,
  lastPointerX: 0,
  lastPointerY: 0,
  didMove: false,
  didChange: false,
  dragRawValue: 0,
  step: 1,
  min: null,
  max: null,
  decimals: 0,
  sensitivity: 1,
  wrapMode: false,
  isPointerLocked: false,
});

export class NumericInputInteraction {
  private readonly onResetInput: (target: EventTarget | null) => boolean;

  private readonly dragState = createNumericInputDragState();

  // A lock can be granted after its drag ended, so ownership must outlive drag state cleanup.
  private readonly pointerLockTargets = new WeakSet<Element>();

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
    const resolved = closestRackNumericInputTarget(target);
    if (!resolved || resolved.input.disabled || resolved.input.readOnly) {
      return false;
    }

    const { input, pointerElement } = resolved;
    const min = this.parseInputBound(input.min);
    const max = this.parseInputBound(input.max);
    const step = this.resolveNumberStep(input);
    const decimals = this.resolveStepDecimals(input);
    const currentValue = Number(input.value);
    const initialValue = Number.isFinite(currentValue) ? currentValue : (min ?? 0);
    const hasFiniteRange = min !== null && max !== null && max > min;
    const wrapMode = input.dataset.dragMode === 'circular' && hasFiniteRange;
    const dragPixelsPerStep = this.resolveDragPixelsPerStep(input);
    const sensitivity = dragPixelsPerStep !== null
      ? step / dragPixelsPerStep
      : hasFiniteRange ? Math.max((max - min) / 480, step) : step;

    this.dragState.pointerId = event.pointerId;
    this.dragState.inputEl = input;
    this.dragState.pointerEl = pointerElement;
    this.dragState.lastPointerX = event.clientX;
    this.dragState.lastPointerY = event.clientY;
    this.dragState.didMove = false;
    this.dragState.didChange = false;
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

    pointerElement.dataset.dragActive = 'true';
    pointerElement.focus();
    pointerElement.setPointerCapture(event.pointerId);
    if (event.pointerType === 'mouse') {
      this.requestPointerLock(pointerElement);
    }

    return true;
  }

  handlePointerMove(clientX: number, clientY: number, isFineDrag = false): void {
    const input = this.dragState.inputEl;
    if (!input || this.dragState.isPointerLocked) {
      return;
    }

    const deltaY = this.dragState.lastPointerY - clientY;
    const deltaX = clientX - this.dragState.lastPointerX;
    this.dragState.lastPointerX = clientX;
    this.dragState.lastPointerY = clientY;
    this.applyDragDelta(deltaX, deltaY, isFineDrag);
  }

  handleLockedMouseMove(event: MouseEvent): void {
    if (!this.isActive() || !this.dragState.isPointerLocked) {
      return;
    }

    this.applyDragDelta(event.movementX, -event.movementY, event.shiftKey);
  }

  handlePointerUp(at: number): void {
    const { inputEl, didMove, didChange } = this.dragState;
    this.clearDragState();

    if (!inputEl) {
      this.clearClickState();
      return;
    }

    if (didMove) {
      if (didChange) {
        this.finalizeChangedInput(inputEl);
      }
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
    const { inputEl, didChange } = this.dragState;
    this.clearDragState();
    if (inputEl && didChange) {
      this.finalizeChangedInput(inputEl);
    }
    this.clearClickState();
  }

  handleWindowBlur(): void {
    if (this.isActive()) {
      this.handlePointerCancel();
      return;
    }
    this.clearClickState();
  }

  handlePointerLockChange(): void {
    const lockedElement = document.pointerLockElement;
    const pointerElement = this.dragState.pointerEl;
    const wasPointerLocked = this.dragState.isPointerLocked;
    const isPointerLocked = lockedElement !== null
      && lockedElement === pointerElement;

    if (
      lockedElement
      && this.pointerLockTargets.has(lockedElement)
      && !isPointerLocked
    ) {
      document.exitPointerLock();
      return;
    }

    this.dragState.isPointerLocked = isPointerLocked;

    if (wasPointerLocked && !isPointerLocked && this.isActive()) {
      this.handlePointerCancel();
    }
  }

  finalizeFromMouseUp(at: number): void {
    if (!this.isActive()) {
      return;
    }

    this.handlePointerUp(at);
  }

  tryResetFromDoubleClick(target: EventTarget | null): boolean {
    const resolved = closestRackNumericInputTarget(target);
    return resolved ? this.onResetInput(resolved.input) : false;
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

  private resolveDragPixelsPerStep(input: HTMLInputElement): number | null {
    const parsed = Number(input.dataset.dragPixelsPerStep);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
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

  private requestPointerLock(pointerElement: HTMLElement): void {
    if (!('requestPointerLock' in pointerElement)) {
      return;
    }

    this.pointerLockTargets.add(pointerElement);
    try {
      void pointerElement.requestPointerLock().catch(() => {
        // Pointer lock is optional; drag still works without it.
      });
    } catch {
      // Pointer lock is optional; drag still works without it.
    }
  }

  private exitPointerLock(pointerElement: HTMLElement | null): void {
    if (!pointerElement || document.pointerLockElement !== pointerElement) {
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

  private applyDragDelta(deltaX: number, deltaY: number, isFineDrag: boolean): void {
    const input = this.dragState.inputEl;
    if (!input) {
      return;
    }

    if (deltaX !== 0 || deltaY !== 0) {
      this.dragState.didMove = true;
    }

    const sensitivityMultiplier = isFineDrag ? SHIFT_DRAG_SENSITIVITY_MULTIPLIER : 1;
    this.dragState.dragRawValue += (deltaY + deltaX * 0.5)
      * this.dragState.sensitivity
      * sensitivityMultiplier;

    const nextValue = this.snapDraggedValue(this.dragState.dragRawValue);
    const nextText = this.formatDraggedValue(nextValue, this.dragState.decimals);
    if (input.value === nextText) {
      return;
    }

    input.value = nextText;
    this.dragState.didChange = true;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  private finalizeChangedInput(input: HTMLInputElement): void {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  private clearClickState(): void {
    this.lastNumberClickInput = null;
    this.lastNumberClickAt = 0;
  }

  private clearDragState(): void {
    const { pointerEl, pointerId } = this.dragState;
    if (pointerEl && pointerId !== null && pointerEl.hasPointerCapture(pointerId)) {
      pointerEl.releasePointerCapture(pointerId);
    }

    this.exitPointerLock(pointerEl);
    if (pointerEl) {
      delete pointerEl.dataset.dragActive;
    }

    Object.assign(this.dragState, createNumericInputDragState());
  }
}
