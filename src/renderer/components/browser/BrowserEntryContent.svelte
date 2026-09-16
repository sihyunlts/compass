<script lang="ts">
  import type { Snippet } from 'svelte';

  let { icon, iconStyle = '', label = '', trailingIcon, children } = $props<{
    icon: string;
    iconStyle?: string;
    label?: string;
    trailingIcon?: string;
    children?: Snippet;
  }>();
</script>

<span class="browser-entry-icon material-symbols-rounded" style={iconStyle} aria-hidden="true">{icon}</span>
{#if children}
  {@render children()}
{:else}
  <span class="browser-entry-label">{label}</span>
{/if}
{#if trailingIcon}
  <span class="browser-entry-icon browser-chevron-icon is-trailing material-symbols-rounded"
    aria-hidden="true">
    {trailingIcon}
  </span>
{/if}

<style lang="scss">
  .browser-entry-icon {
    width: 1.25rem;
    height: 1.5rem;
    flex: 0 0 1.25rem;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-right: var(--gap-2);

    &.is-trailing {
      margin-right: 0;
      margin-left: var(--gap-2);
    }
  }
  .browser-entry-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: left;
  }
</style>
