<svelte:options runes={true} />

<script lang="ts">
  import FieldShell from '../../renderer/components/fields/FieldShell.svelte';
</script>

<div class="device-controls">
  <FieldShell label="Action">
    <input type="text" value="Reverse Note Timeline" readonly />
  </FieldShell>
</div>
