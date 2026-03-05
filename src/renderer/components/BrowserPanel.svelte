<script lang="ts">
  import {
    BROWSER_EFFECTS,
    BROWSER_GENERATORS,
    isBrowserDeviceKind,
    type BrowserDeviceKind,
  } from '../services/devices';

  type BrowserPointerDownPayload = {
    kind: BrowserDeviceKind;
    sourceEvent: PointerEvent;
    itemEl: HTMLElement;
  };

  const noopDeviceAdd = (): void => {};
  const noopBrowserPointerDown = (): void => {};

  let {
    onDeviceAdd = noopDeviceAdd,
    onBrowserPointerDown = noopBrowserPointerDown,
  } = $props<{
    onDeviceAdd: (kind: BrowserDeviceKind) => void;
    onBrowserPointerDown: (payload: BrowserPointerDownPayload) => void;
  }>();

  const resolveBrowserItem = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) {
      return null;
    }
    return target.closest<HTMLElement>('.browser-item[data-browser-kind]');
  };

  const handleDoubleClick = (event: MouseEvent): void => {
    const item = resolveBrowserItem(event.target);
    if (!item) {
      return;
    }

    const kindRaw = item.dataset.browserKind;
    if (!isBrowserDeviceKind(kindRaw)) {
      return;
    }

    onDeviceAdd(kindRaw);
  };

  const handlePointerDown = (event: PointerEvent): void => {
    const item = resolveBrowserItem(event.target);
    if (!item) {
      return;
    }

    const kindRaw = item.dataset.browserKind;
    if (!isBrowserDeviceKind(kindRaw)) {
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

<aside
  class="browser-panel"
  ondragstart={handleDragStart}
  ondblclick={handleDoubleClick}
  onpointerdown={handlePointerDown}
>
  <div
    class="browser-view"
  >
    <section class="browser-group">
      <span class="browser-group-title">Generators</span>
      <ul class="browser-list">
        {#each BROWSER_GENERATORS as item (item.kind)}
          <li
            class="browser-item"
            data-browser-kind={item.kind}
          >
            <span>{item.label}</span>
          </li>
        {/each}
      </ul>
    </section>
    <section class="browser-group">
      <span class="browser-group-title">Effects</span>
      <ul class="browser-list">
        {#each BROWSER_EFFECTS as item (item.kind)}
          <li
            class="browser-item"
            data-browser-kind={item.kind}
          >
            <span>{item.label}</span>
          </li>
        {/each}
      </ul>
    </section>
  </div>
</aside>

<style lang="scss">
  .browser-panel {
    display: flex;
    flex: 0 0 var(--sidebar-width);
    padding: var(--gap-10);
    background: var(--neutral-10);
    width: var(--sidebar-width);

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
    margin-top: var(--gap-32);
    border-radius: var(--radius-4);
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
    border-radius: var(--radius-4);
    padding: var(--gap-6) var(--gap-8);
    font-size: var(--text-12);
    background: var(--neutral-20);

    &:global(.is-dragging) {
      opacity: 0.7;
    }
  }
</style>
