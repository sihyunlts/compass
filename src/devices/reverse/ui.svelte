<svelte:options runes={true} />

<script lang="ts">
  import FieldShell from '../../renderer/components/fields/FieldShell.svelte';
  import { i18n } from '../../renderer/i18n.svelte';
</script>

<div class="device-controls">
  <FieldShell label={i18n.t('control.action')}>
    <input type="text" value={i18n.t('control.reverseNoteTimeline')} readonly />
  </FieldShell>
</div>
