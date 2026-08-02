<svelte:options runes={true} />

<script lang="ts">
  import type { RendererDeviceTabDefinition } from '../../../devices/types';
  import { i18n } from '../../i18n.svelte';

  let {
    tabs,
    activeTab,
    ariaLabel = i18n.t('rack.deviceTabs'),
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
      <span class="device-tab-label">
        {tab.id === 'curve'
          ? i18n.t('tab.curve')
          : tab.id === 'map'
            ? i18n.t('tab.map')
            : tab.label}
      </span>
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
    padding: 0 var(--gap-4);
    background: transparent;
    color: var(--color-text-secondary);
    font-size: var(--text-12);
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;

    &:disabled {
      cursor: default;
      color: color-mix(in oklch, var(--color-text-secondary) 55%, transparent);
    }

    &.is-active {
      background: var(--color-surface-floating-interactive);
      color: var(--color-text-primary);
    }
  }

  .device-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
  }

</style>
