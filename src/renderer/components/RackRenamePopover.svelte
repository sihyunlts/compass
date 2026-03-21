<svelte:options runes={true} />

<script lang="ts">
  import { isEventTargetWithinFloatingLayer } from '../features/rack/floating-layer';

  let {
    x,
    y,
    value,
    ariaLabel,
    onInput,
    onBlur,
    onKeyDown,
  } = $props<{
    x: number;
    y: number;
    value: string;
    ariaLabel: string;
    onInput: (event: Event) => void;
    onBlur: (event: FocusEvent) => void;
    onKeyDown: (event: KeyboardEvent) => void;
  }>();

  let popoverEl = $state<HTMLDivElement | null>(null);
  let inputEl = $state<HTMLInputElement | null>(null);

  export const measure = (): { width: number; height: number } => ({
    width: popoverEl?.offsetWidth ?? 0,
    height: popoverEl?.offsetHeight ?? 0,
  });

  export const focusSelect = (): void => {
    inputEl?.focus();
    inputEl?.select();
  };

  export const containsTarget = (eventTarget: EventTarget | null): boolean =>
    isEventTargetWithinFloatingLayer(eventTarget, popoverEl);
</script>

<div
  bind:this={popoverEl}
  class="rack-rename-popover"
  style:transform={`translate3d(${x}px, ${y}px, 0)`}
  data-preserve-rack-selection="true"
>
  <input
    bind:this={inputEl}
    class="rack-rename-input"
    type="text"
    {value}
    data-preserve-rack-selection="true"
    aria-label={ariaLabel}
    oninput={onInput}
    onblur={onBlur}
    onkeydown={onKeyDown}
  />
</div>

<style lang="scss">
  .rack-rename-popover {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 43;
    min-width: 120px;
    padding: var(--gap-4);
    border: 1px solid var(--neutral-30);
    border-radius: var(--radius-8);
    background: var(--neutral-10);
  }

  .rack-rename-input {
    display: block;
    box-sizing: border-box;
    width: 100%;
    height: 1.75rem;
    padding: var(--gap-6) var(--gap-8);
    border-radius: var(--radius-4);
    background: var(--neutral-20);
    font-size: var(--text-13);
  }
</style>
