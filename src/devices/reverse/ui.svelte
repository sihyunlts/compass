<svelte:options runes={true} />

<script lang="ts">
  import DeviceBodyLayout from '../../renderer/components/rack/DeviceBodyLayout.svelte';
  import { i18n } from '../../renderer/i18n.svelte';
</script>

<DeviceBodyLayout kind="content">
  <div class="reverse-summary">
    <span class="material-symbols-rounded reverse-icon" aria-hidden="true">swap_horiz</span>
    <span class="reverse-description">{i18n.t('device.reverseDescription')}</span>
  </div>
</DeviceBodyLayout>

<style lang="scss">
  .reverse-summary {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--gap-8);
    min-width: 0;
    color: var(--color-text-secondary);
    text-align: center;
  }

  .reverse-icon {
    color: var(--device-control-accent);
    font-size: calc(var(--gap-32) + var(--gap-8));
    line-height: 1;
  }

  .reverse-description {
    font-size: var(--text-12);
    white-space: pre-line;
  }
</style>
