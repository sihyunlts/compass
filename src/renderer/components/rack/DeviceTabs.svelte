<svelte:options runes={true} />

<script lang="ts">
  import type { RendererDeviceTabDefinition } from '../../../devices/types';

  let {
    tabs,
    activeTab,
    ariaLabel = 'Device tabs',
    class: className = '',
    onChange,
  } = $props<{
    tabs: readonly RendererDeviceTabDefinition[];
    activeTab: string;
    ariaLabel?: string;
    class?: string;
    onChange: (tabId: string) => void;
  }>();

  const rootClass = $derived(`device-tabs ${className}`.trim());

  const selectTab = (tab: RendererDeviceTabDefinition): void => {
    if (tab.disabled || tab.id === activeTab) {
      return;
    }

    onChange(tab.id);
  };
</script>

<div
  class={rootClass}
  role="tablist"
  aria-label={ariaLabel}
  tabindex="-1"
  onpointerdown={(event) => event.stopPropagation()}
  onclick={(event) => event.stopPropagation()}
  onkeydown={(event) => event.stopPropagation()}
>
  {#each tabs as tab (tab.id)}
    <button
      type="button"
      class="device-tab"
      class:is-active={tab.id === activeTab}
      role="tab"
      aria-selected={tab.id === activeTab}
      disabled={tab.disabled}
      onclick={() => selectTab(tab)}
    >
      <span class="device-tab-label">{tab.label}</span>
    </button>
  {/each}
</div>

<style lang="scss">
  .device-tabs {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: var(--gap-2);
    min-width: 0;
    padding: 0;
    border: 0;
    background: transparent;
  }

  .device-tab {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--gap-4);
    min-width: 0;
    min-height: 1rem;
    border: 0;
    border-radius: var(--radius-4);
    padding: 0 var(--gap-6);
    background: transparent;
    color: var(--neutral-60);
    font-size: var(--text-12);
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;

    &:disabled {
      cursor: default;
      color: color-mix(in oklch, var(--neutral-60) 55%, transparent);
    }

    &.is-active {
      background: var(--neutral-30);
      color: var(--neutral-90);
    }
  }

  .device-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

</style>
