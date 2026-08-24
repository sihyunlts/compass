<script lang="ts">
  import FloatingDropdown from '../primitives/FloatingDropdown.svelte';
  import SplitButton from '../primitives/SplitButton.svelte';
  import { i18n } from '../../i18n.svelte';

  type RackActionItem = {
    id: string;
    label: string;
    run: () => void;
    disabled?: boolean;
    separatorBefore?: boolean;
  };

  let {
    title,
    dirty = false,
    disabled = false,
    onNewRack,
    onSaveRack,
    onSaveRackAs,
    onRevertRack,
    canRevertRack = false,
    onEditRackInfo,
  } = $props<{
    title: string;
    dirty?: boolean;
    disabled?: boolean;
    onNewRack: () => void;
    onSaveRack: () => void;
    onSaveRackAs: () => void;
    onRevertRack: () => void;
    canRevertRack?: boolean;
    onEditRackInfo: () => void;
  }>();

  let rootEl = $state<HTMLDivElement | null>(null);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let isOpen = $state(false);

  const displayTitle = $derived(dirty ? `${title}*` : title);
  const titleHint = $derived(i18n.t('info.rackTitle'));
  const titleLabel = $derived(
    dirty
      ? i18n.t('rack.titleDirtyAria', { title })
      : i18n.t('rack.titleAria', { title }),
  );
  const rackActions = $derived.by((): RackActionItem[] => [
    {
      id: 'rack-new-button',
      label: i18n.t('rack.new'),
      run: onNewRack,
    },
    { id: 'rack-save-button', label: i18n.t('rack.save'), run: onSaveRack },
    { id: 'rack-save-as-button', label: i18n.t('rack.saveAs'), run: onSaveRackAs },
    {
      id: 'rack-revert-button',
      label: i18n.t('rack.revertSaved'),
      run: onRevertRack,
      disabled: !canRevertRack,
      separatorBefore: true,
    },
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
  aria-label={titleLabel}
>
  <SplitButton
    variant="outline"
    class="workspace-rack-title-button"
    text={displayTitle}
    title={titleHint}
    label={titleLabel}
    onClick={onEditRackInfo}
    menuId="rack-file-actions-trigger"
    menuDisabled={disabled}
    menuLabel={i18n.t('rack.actions')}
    menuTitle={i18n.t('rack.actions')}
    menuExpanded={isOpen}
    menuPopupType="menu"
    onMenuClick={toggleMenu}
  />

  <FloatingDropdown
    open={isOpen}
    anchorEl={rootEl}
    onClose={closeMenu}
  >
    <div
      class="floating-menu-list"
      role="menu"
      aria-label={i18n.t('rack.actions')}
    >
      {#each rackActions as action (action.id)}
        {#if action.separatorBefore}
          <hr class="floating-menu-separator" />
        {/if}
        <button
          id={action.id}
          class="floating-menu-item"
          type="button"
          role="menuitem"
          disabled={disabled || action.disabled}
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
    --split-button-expanded-background: var(--color-surface-interactive);
    --split-button-hover-background: var(--color-surface-interactive);

    display: inline-flex;
    align-items: center;
    flex: 0 1 auto;
    min-width: 0;
    color: var(--color-text-primary);
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
