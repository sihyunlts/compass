<svelte:options runes={true} />

<script lang="ts">
  import { Spring } from 'svelte/motion';
  import { SPRING_PRECISION } from '../../motion';

  let {
    id,
    checked,
    label,
    disabled = false,
    class: className = '',
    onCheckedChange,
  } = $props<{
    id?: string;
    checked: boolean;
    label: string;
    disabled?: boolean;
    class?: string;
    onCheckedChange: (checked: boolean) => void;
  }>();

  const rootClass = $derived(`switch ${className}`.trim());
  const thumbX = Spring.of(
    () => checked ? 12 : 0,
    {
      stiffness: 0.2,
      damping: 1,
      precision: SPRING_PRECISION,
    },
  );
</script>

<button
  {id}
  class={rootClass}
  class:is-checked={checked}
  type="button"
  role="switch"
  aria-label={label}
  aria-checked={checked}
  {disabled}
  onclick={() => onCheckedChange(!checked)}
>
  <span
    class="switch-thumb"
    aria-hidden="true"
    style:transform={`translateX(${thumbX.current}px)`}
  ></span>
</button>

<style lang="scss">
  .switch {
    position: relative;
    flex: 0 0 auto;
    width: 1.75rem;
    height: var(--gap-16);
    padding: 0;
    border: 0;
    border-radius: var(--radius-round);
    background: var(--color-surface-emphasis);
    transition: background-color 200ms ease;
    -webkit-app-region: no-drag;

    &.is-checked {
      background: var(--device-control-accent, var(--color-surface-inverse));

      .switch-thumb {
        background: var(--color-surface);
      }
    }

    &:disabled {
      opacity: 0.6;
    }
  }

  .switch-thumb {
    position: absolute;
    top: var(--gap-2);
    left: var(--gap-2);
    width: var(--gap-12);
    height: var(--gap-12);
    border-radius: var(--radius-round);
    background: var(--color-surface-inverse);
    pointer-events: none;
    transition: background-color 200ms ease;
  }
</style>
