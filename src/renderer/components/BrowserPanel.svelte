<script lang="ts">
  import Button from './Button.svelte';
  import {
    getRendererDeviceLabel,
    RENDERER_DEVICE_GROUPS,
    type RendererDeviceKind,
  } from '../../devices';
  import type {
    PresetBrowserFileItem,
    PresetBrowserSection,
  } from '../../shared/contracts/ipc/presets';
  import type { BrowserInsertSource } from './device-rack-types';

  export type BrowserPanelPage = 'devices' | 'presets';

  interface BrowserCatalogItem {
    kind: RendererDeviceKind;
    label: string;
  }

  type BrowserPointerDownPayload = {
    source: BrowserInsertSource;
    badgeLabel: string;
    sourceEvent: PointerEvent;
    itemEl: HTMLElement;
  };

  const toBrowserCatalogItems = (
    kinds: readonly RendererDeviceKind[],
  ): BrowserCatalogItem[] => kinds.map((kind) => ({
    kind,
    label: getRendererDeviceLabel(kind),
  }));

  const browserGenerators = toBrowserCatalogItems(RENDERER_DEVICE_GROUPS.generator);
  const browserEffects = toBrowserCatalogItems(RENDERER_DEVICE_GROUPS.effect);

  let {
    activePage = 'devices',
    presetSections = [] as PresetBrowserSection[],
    isPresetLoading = false,
    presetErrorText = null,
    onPageSelect = () => {},
    onDeviceAdd,
    onBrowserPointerDown,
    onPresetEntryOpen,
    onPresetFilePointerDown,
  } = $props<{
    activePage?: BrowserPanelPage;
    presetSections?: PresetBrowserSection[];
    isPresetLoading?: boolean;
    presetErrorText?: string | null;
    onPageSelect?: (page: BrowserPanelPage) => void;
    onDeviceAdd: (kind: RendererDeviceKind) => void;
    onBrowserPointerDown: (payload: BrowserPointerDownPayload) => void;
    onPresetEntryOpen: (entry: PresetBrowserFileItem) => void | Promise<void>;
    onPresetFilePointerDown: (
      entry: PresetBrowserFileItem,
      event: PointerEvent,
      itemEl: HTMLElement,
    ) => void | Promise<void>;
  }>();

  const handleDevicePointerDown = (
    item: BrowserCatalogItem,
    event: PointerEvent,
  ): void => {
    const itemEl = event.currentTarget;
    if (!(itemEl instanceof HTMLElement)) {
      return;
    }

    onBrowserPointerDown({
      source: {
        kind: 'device-kind',
        deviceKind: item.kind,
      },
      badgeLabel: `+ ${item.label}`,
      sourceEvent: event,
      itemEl,
    });
  };

  const handlePresetPointerDown = (
    entry: PresetBrowserFileItem,
    event: PointerEvent,
  ): void => {
    if (entry.presetType === 'rack') {
      return;
    }

    const itemEl = event.currentTarget;
    if (!(itemEl instanceof HTMLElement)) {
      return;
    }

    void onPresetFilePointerDown(entry, event, itemEl);
  };

  const handleDragStart = (event: DragEvent): void => {
    event.preventDefault();
  };
</script>

<aside class="browser-panel">
  <div class="browser-view">
    <div class="browser-page-switch">
      <Button
        class="browser-page-switch-button"
        variant="icon"
        label="Devices"
        icon="widgets"
        pressed={activePage === 'devices'}
        onClick={() => onPageSelect('devices')}
      />
      <Button
        class="browser-page-switch-button"
        variant="icon"
        label="Presets"
        icon="inventory_2"
        pressed={activePage === 'presets'}
        onClick={() => onPageSelect('presets')}
      />
    </div>

    {#if activePage === 'devices'}
      <div class="browser-page-panel">
        <section class="browser-group">
          <span class="browser-group-title">Generators</span>
          <ul class="browser-list">
            {#each browserGenerators as item (item.kind)}
              <li>
                <button
                  class="browser-item"
                  type="button"
                  ondragstart={handleDragStart}
                  ondblclick={() => onDeviceAdd(item.kind)}
                  onpointerdown={(event) => handleDevicePointerDown(item, event)}
                >
                  <span>{item.label}</span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
        <section class="browser-group">
          <span class="browser-group-title">Effects</span>
          <ul class="browser-list">
            {#each browserEffects as item (item.kind)}
              <li>
                <button
                  class="browser-item"
                  type="button"
                  ondragstart={handleDragStart}
                  ondblclick={() => onDeviceAdd(item.kind)}
                  onpointerdown={(event) => handleDevicePointerDown(item, event)}
                >
                  <span>{item.label}</span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      </div>
    {:else}
      <div class="browser-page-panel">
        {#if isPresetLoading}
          <p class="browser-status">Loading presets...</p>
        {:else if presetErrorText}
          <p class="browser-status browser-status-error">{presetErrorText}</p>
        {:else if presetSections.length === 0}
          <p class="browser-status">No presets yet.</p>
        {:else}
          {#each presetSections as section (section.id)}
            <section class="browser-group">
              <span class="browser-group-title">{section.title}</span>
              <ul class="browser-list">
                {#each section.entries as entry (`${entry.presetType}:${entry.relativePath.join('/')}`)}
                  <li>
                    <button
                      class="browser-item"
                      type="button"
                      ondragstart={handleDragStart}
                      ondblclick={() => onPresetEntryOpen(entry)}
                      onpointerdown={(event) => handlePresetPointerDown(entry, event)}
                    >
                      <span>{entry.name}</span>
                    </button>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</aside>

<style lang="scss">
  .browser-panel {
    display: flex;
    flex: 0 0 var(--sidebar-width);
    padding: var(--gap-10);
    background: var(--neutral-10);

    &::before {
      content: '';
      position: absolute;
      left: 0;
      top: 0;
      width: var(--sidebar-width);
      height: var(--gap-48);
      -webkit-app-region: drag;
      z-index: -1;
    }
  }

  .browser-view {
    flex: 1;
    min-width: 0;
    min-height: 0;
    margin-top: var(--gap-32);
    display: flex;
    gap: var(--gap-10);
  }

  .browser-page-switch {
    display: flex;
    flex-direction: column;
    align-self: flex-start;
    gap: var(--gap-6);
    -webkit-app-region: no-drag;

    &-button {
      color: var(--neutral-50);
    }
  }

  .browser-page-panel {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    -webkit-app-region: no-drag;
  }

  .browser-group {
    display: flex;
    flex-direction: column;
    margin-bottom: var(--gap-16);
    gap: var(--gap-8);

    &-title {
      font-size: var(--text-12);
      color: var(--neutral-50);
    }
  }

  .browser-list {
    margin: var(--gap-0);
    padding: var(--gap-0);
    list-style: none;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-6);
  }

  .browser-item {
    width: 100%;
    border: 0;
    border-radius: var(--radius-4);
    padding: var(--gap-6) var(--gap-8);
    font-size: var(--text-12);
    background: var(--neutral-20);
    color: var(--neutral-90);
    text-align: left;
    cursor: pointer;

    &:global(.is-dragging) {
      opacity: 0.7;
    }
  }

  .browser-status {
    margin: 0;
    font-size: var(--text-12);
    color: var(--neutral-50);
  }

  .browser-status-error {
    color: var(--accent-300);
  }
</style>
