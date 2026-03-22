<script lang="ts">
  import { tick } from 'svelte';
  import { resolveRackDisplayName, resolveStoredRackName } from '../features/rack/display-names';

  let {
    name = null,
    onCommit = () => {},
  } = $props<{
    name?: string | null;
    onCommit?: (rawName: string) => void;
  }>();

  let inputEl = $state<HTMLInputElement | null>(null);
  let isEditing = $state(false);
  let draft = $state('');
  let skipBlur = false;

  const displayName = $derived.by(() => resolveRackDisplayName({ name }));

  const releaseBlurGuard = (): void => {
    window.setTimeout(() => {
      skipBlur = false;
    }, 0);
  };

  const focusInput = (): void => {
    void tick().then(() => {
      inputEl?.focus();
      inputEl?.select();
    });
  };

  const startEditing = (): void => {
    const nextDraft = resolveStoredRackName({ name }) ?? displayName;
    if (isEditing && draft === nextDraft) {
      focusInput();
      return;
    }

    isEditing = true;
    draft = nextDraft;
    focusInput();
  };

  const finishEditing = (shouldCommit: boolean): void => {
    if (!isEditing) {
      return;
    }

    skipBlur = true;
    const committedDraft = draft;
    isEditing = false;
    draft = '';
    if (shouldCommit) {
      onCommit(committedDraft);
    }
    releaseBlurGuard();
  };

  const handleLabelDoubleClick = (event: MouseEvent): void => {
    event.stopPropagation();
    if (event.button !== 0) {
      return;
    }

    startEditing();
  };

  const handleLabelKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    startEditing();
  };

  const handleInput = (event: Event): void => {
    const target = event.currentTarget;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    draft = target.value;
  };

  const handleInputBlur = (): void => {
    if (skipBlur) {
      return;
    }

    finishEditing(true);
  };

  const handleInputKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();

    if (event.key === 'Enter') {
      event.preventDefault();
      finishEditing(true);
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      finishEditing(false);
    }
  };
</script>

<div
  class="workspace-rack-title"
  data-preserve-rack-selection="true"
>
  {#if isEditing}
    <input
      bind:this={inputEl}
      class="workspace-rack-title-input"
      type="text"
      value={draft}
      data-preserve-rack-selection="true"
      aria-label="Rename rack"
      oninput={handleInput}
      onblur={handleInputBlur}
      onkeydown={handleInputKeyDown}
      onpointerdown={(event) => event.stopPropagation()}
      onclick={(event) => event.stopPropagation()}
      oncontextmenu={(event) => event.stopPropagation()}
    />
  {:else}
    <button
      class="workspace-rack-title-button"
      type="button"
      data-preserve-rack-selection="true"
      title={displayName}
      aria-label={`Rack name: ${displayName}. Press Enter to rename.`}
      ondblclick={handleLabelDoubleClick}
      onkeydown={handleLabelKeyDown}
    >
      {displayName}
    </button>
  {/if}
</div>

<style lang="scss">
  .workspace-rack-title {
    display: inline-flex;
    align-items: center;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 8rem;
    -webkit-app-region: no-drag;

    &-button,
    &-input {
      display: block;
      box-sizing: border-box;
      min-width: 0;
      height: 1.75rem;
      padding: var(--gap-4) var(--gap-8);
      border-radius: var(--radius-4);
      font-size: var(--text-14);
      font-weight: 500;
      -webkit-app-region: no-drag;
    }

    &-button {
      border: 1px solid transparent;
      background: transparent;
      color: var(--neutral-90);
      text-align: left;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      cursor: text;
      max-width: 100%;

      &:hover,
      &:focus-visible {
        background: var(--neutral-20);
        outline: none;
      }
    }

    &-input {
      border: 1px solid var(--neutral-30);
      background: var(--neutral-20);
      color: var(--neutral-90);
      width: min(12rem, 24vw);

      &:focus {
        outline: none;
        border-color: var(--accent-500);
      }
    }
  }
</style>
