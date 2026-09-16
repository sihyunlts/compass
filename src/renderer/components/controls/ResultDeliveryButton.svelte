<svelte:options runes={true} />

<script lang="ts">
  import { i18n } from '../../i18n.svelte';
  import Button from '../primitives/Button.svelte';
  import SplitButton from '../primitives/SplitButton.svelte';

  let {
    text,
    disabled = false,
    showMidiSave = false,
    onDeliver,
    onSaveMidi,
  } = $props<{
    text: string;
    disabled?: boolean;
    showMidiSave?: boolean;
    onDeliver: () => void;
    onSaveMidi: () => void;
  }>();
</script>

<div class="result-delivery-button">
  {#if showMidiSave}
    <SplitButton
      id="delivery-button"
      variant="primary"
      {text}
      {disabled}
      secondaryId="save-midi-button"
      secondaryLabel={i18n.t('delivery.saveMidi')}
      secondaryTitle={i18n.t('delivery.saveMidi')}
      secondaryIcon="save_alt"
      secondaryDisabled={disabled}
      onClick={onDeliver}
      onSecondaryClick={onSaveMidi}
    />
  {:else}
    <Button
      id="delivery-button"
      variant="primary"
      {text}
      {disabled}
      onClick={onDeliver}
    />
  {/if}
</div>

<style lang="scss">
  .result-delivery-button {
    display: inline-flex;
  }
</style>
