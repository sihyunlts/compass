<svelte:options runes={true} />

<script lang="ts">
  let {
    id,
    label,
    icon,
    isActive = false,
    isPressed,
    class: className = '',
    disabled = false,
    onClick,
  } = $props<{
    id?: string;
    label: string;
    icon: string;
    isActive?: boolean;
    isPressed?: boolean;
    class?: string;
    disabled?: boolean;
    onClick?: (event: MouseEvent) => void;
  }>();
</script>

<button
  {id}
  class={`icon-button ${className}`.trim()}
  class:is-active={isActive}
  type="button"
  aria-label={label}
  aria-pressed={isPressed}
  {disabled}
  onclick={onClick}
>
  <span class="material-symbols-rounded" aria-hidden="true">{icon}</span>
</button>

<style lang="scss">
  .icon-button {
    width: 2rem;
    height: 2rem;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;

    &.is-active {
      background: var(--accent-500);
      color: var(--accent-050);
    }

    .material-symbols-rounded {
      font-size: var(--text-18);
      line-height: 1;
      font-variation-settings: 'FILL' 1, 'wght' 400;
    }
  }
</style>
