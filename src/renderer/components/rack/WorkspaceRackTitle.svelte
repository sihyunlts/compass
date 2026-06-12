<script lang="ts">
  import FloatingDropdown from '../primitives/FloatingDropdown.svelte';
  import SplitButton from '../primitives/SplitButton.svelte';

  type RackActionItem = {
    id: string;
    label: string;
    run: () => void;
  };

  let {
    title,
    dirty = false,
    disabled = false,
    onNewRack,
    onSaveRack,
    onSaveRackAs,
  } = $props<{
    title: string;
    dirty?: boolean;
    disabled?: boolean;
    onNewRack: () => void;
    onSaveRack: () => void;
    onSaveRackAs: () => void;
  }>();

  let rootEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let isOpen = $state(false);

  const displayTitle = $derived(dirty ? `${title}*` : title);
  const titleText = $derived(dirty ? `${title} - unsaved changes` : title);
  const titleLabel = $derived(dirty ? `Rack: ${title}, unsaved changes` : `Rack: ${title}`);
  const rackActions = $derived.by((): RackActionItem[] => [
    { id: 'rack-new-button', label: 'New', run: onNewRack },
    { id: 'rack-save-button', label: 'Save', run: onSaveRack },
    { id: 'rack-save-as-button', label: 'Save As', run: onSaveRackAs },
  ]);

  const closeMenu = (restoreFocus: boolean): void => {
    isOpen = false;
    if (restoreFocus) {
      triggerEl?.focus();
    }
  };

  const toggleMenu = (event: MouseEvent | KeyboardEvent): void => {
    triggerEl = event.currentTarget as HTMLButtonElement;
    isOpen = !isOpen;
  };

  const runAction = (action: RackActionItem): void => {
    closeMenu(true);
    action.run();
  };
</script>

<div
  bind:this={rootEl}
  class="workspace-rack-title"
  title={titleText}
  aria-label={titleLabel}
>
  <SplitButton
    variant="outline"
    class="workspace-rack-title-button"
    text={displayTitle}
    title={titleText}
    label={titleLabel}
    menuId="rack-file-actions-trigger"
    menuDisabled={disabled}
    menuLabel="Rack actions"
    menuTitle="Rack actions"
    menuExpanded={isOpen}
    menuPopupType="menu"
    onMenuClick={toggleMenu}
  />

  <FloatingDropdown
    open={isOpen}
    anchorEl={rootEl}
    class="rack-file-actions-menu"
    onClose={closeMenu}
  >
    <div class="rack-file-actions-list floating-menu-list" role="menu" aria-label="Rack actions">
      {#each rackActions as action (action.id)}
        <button
          id={action.id}
          class="floating-menu-item"
          type="button"
          role="menuitem"
          disabled={disabled}
          onclick={() => runAction(action)}
        >
          {action.label}
        </button>
      {/each}
    </div>
  </FloatingDropdown>
</div>

<style lang="scss">
  .workspace-rack-title {
    display: inline-flex;
    align-items: center;
    flex: 0 1 auto;
    min-width: 0;
    max-width: 10rem;
    color: var(--neutral-90);
    font-weight: 500;

    :global(.workspace-rack-title-button) {
      min-width: 0;
      max-width: 100%;
      font-weight: inherit;
    }

    :global(.workspace-rack-title-button .split-button-main) {
      min-width: 0;
    }

  }
</style>
