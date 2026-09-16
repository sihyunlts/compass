<script lang="ts">
  import { onMount } from 'svelte';

  let {
    value,
    ariaLabel,
    disabled = false,
    onValueChange,
    onCommit,
    onCancel,
  } = $props<{
    value: string;
    ariaLabel: string;
    disabled?: boolean;
    onValueChange: (value: string) => void;
    onCommit: () => void | Promise<void>;
    onCancel: () => void;
  }>();

  let input = $state<HTMLInputElement | null>(null);
  let skipBlur = false;

  onMount(() => {
    input?.focus();
    input?.select();
  });

  const commit = (): void => {
    if (!value.trim()) {
      onCancel();
      return;
    }
    void onCommit();
  };
</script>

<input bind:this={input} class="browser-entry-name-input" type="text" {value} {disabled}
  aria-label={ariaLabel}
  onpointerdown={(event) => event.stopPropagation()}
  onclick={(event) => event.stopPropagation()}
  ondblclick={(event) => event.stopPropagation()}
  oninput={(event) => onValueChange(event.currentTarget.value)}
  onkeydown={(event) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.isComposing) return;
      skipBlur = true;
      commit();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      skipBlur = true;
      onCancel();
    }
  }}
  onblur={() => {
    if (skipBlur) {
      skipBlur = false;
      return;
    }
    commit();
  }} />

<style lang="scss">
  .browser-entry-name-input {
    flex: 1 1 0;
    min-width: 0;
    width: 0;
    height: 1.5rem;
    padding: 0;
    border-radius: 0;
    background: transparent;
    font: inherit;
  }
</style>
