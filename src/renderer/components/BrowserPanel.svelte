<script lang="ts">
  import Button from './Button.svelte';
  import {
    getRendererDeviceLabel,
    RENDERER_DEVICE_GROUPS,
    isRendererDeviceKind,
    type RendererDeviceKind,
  } from '../../devices';

  export type BrowserPanelPage = 'devices' | 'presets';

  interface BrowserCatalogItem {
    kind: RendererDeviceKind;
    label: string;
  }

  type BrowserPointerDownPayload = {
    kind: RendererDeviceKind;
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

  const noopDeviceAdd = (): void => {};
  const noopBrowserPointerDown = (): void => {};

  let {
    activePage = 'devices',
    onPageSelect = () => {},
    onDeviceAdd = noopDeviceAdd,
    onBrowserPointerDown = noopBrowserPointerDown,
  } = $props<{
    activePage?: BrowserPanelPage;
    onPageSelect?: (page: BrowserPanelPage) => void;
    onDeviceAdd: (kind: RendererDeviceKind) => void;
    onBrowserPointerDown: (payload: BrowserPointerDownPayload) => void;
  }>();

  const handleDoubleClick = (kindRaw: string): void => {
    if (!isRendererDeviceKind(kindRaw)) {
      return;
    }

    onDeviceAdd(kindRaw);
  };

  const handlePointerDown = (kindRaw: string, event: PointerEvent): void => {
    if (!isRendererDeviceKind(kindRaw)) {
      return;
    }

    const item = event.currentTarget;
    if (!(item instanceof HTMLElement)) {
      return;
    }

    onBrowserPointerDown({
      kind: kindRaw,
      sourceEvent: event,
      itemEl: item,
    });
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
                  ondblclick={() => handleDoubleClick(item.kind)}
                  onpointerdown={(event) => handlePointerDown(item.kind, event)}
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
                  ondblclick={() => handleDoubleClick(item.kind)}
                  onpointerdown={(event) => handlePointerDown(item.kind, event)}
                >
                  <span>{item.label}</span>
                </button>
              </li>
            {/each}
          </ul>
        </section>
      </div>
    {:else}
      <div class="browser-page-panel"></div>
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
</style>
