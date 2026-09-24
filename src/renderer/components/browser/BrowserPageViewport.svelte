<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { prefersReducedMotion } from 'svelte/motion';
  import type { BrowserPage } from '../../features/browser/types';
  import {
    BROWSER_SETTINGS_FADE_DURATION_MS,
    BROWSER_SETTINGS_SPRING_TRANSITION,
    browserSettingsFadeEasing,
  } from './browser-panel-motion';

  let {
    page,
    reduceAnimation,
    reduceBlur,
    isDropTarget,
    panel = $bindable<HTMLDivElement | null>(null),
    children,
  }: {
    page: BrowserPage;
    reduceAnimation: boolean;
    reduceBlur: boolean;
    isDropTarget: boolean;
    panel?: HTMLDivElement | null;
    children: Snippet;
  } = $props();

  const scrollPositions: Record<BrowserPage, number> = {
    devices: 0, groups: 0, racks: 0, settings: 0,
  };
  let previousPage = untrack(() => page);
  let crossesSettings = $state(false);

  $effect.pre(() => {
    const nextPage = page;
    crossesSettings = (previousPage === 'settings') !== (nextPage === 'settings');
    previousPage = nextPage;
  });

  const canAnimate = () => crossesSettings && !reduceAnimation && !prefersReducedMotion.current;
  const pageFade = (node: Element) => canAnimate()
    ? fade(node, {
      duration: BROWSER_SETTINGS_FADE_DURATION_MS,
      easing: browserSettingsFadeEasing,
    })
    : { duration: 0 };
  const libraryFly = (node: Element, mountedPage: BrowserPage) =>
    canAnimate() && mountedPage !== 'settings'
      ? fly(node, {
        x: 40,
        opacity: 1,
        duration: BROWSER_SETTINGS_SPRING_TRANSITION.durationMs,
        easing: BROWSER_SETTINGS_SPRING_TRANSITION.easing,
      })
      : { duration: 0 };

  const trackPageLayer = (layer: HTMLDivElement, mountedPage: BrowserPage) => {
    const scrollPanel = layer.firstElementChild as HTMLDivElement;
    const content = scrollPanel.firstElementChild!;
    const body = content.querySelector('.browser-page-body')!;
    const stack = layer.parentElement!;
    let isOutgoing = false;
    panel = scrollPanel;
    scrollPanel.scrollTop = scrollPositions[mountedPage];

    const update = () => {
      if (isOutgoing || panel !== scrollPanel) return;
      const maximum = Math.max(0, scrollPanel.scrollHeight - scrollPanel.clientHeight);
      const position = Math.min(maximum, Math.max(0, scrollPanel.scrollTop));
      scrollPositions[mountedPage] = position;
      for (const [edge, distance] of [['top', position], ['bottom', maximum - position]] as const) {
        const strength = Math.min(1, distance / 32);
        stack.style.setProperty(`--browser-page-${edge}-effect-strength`, String(strength));
        layer.style.setProperty(`--browser-page-${edge}-mask-opacity`, String(1 - strength * 0.8));
      }
    };
    // Observer bookkeeping is not rendered or read by reactive effects.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const observedHeights = new Map<Element, number>();
    const observer = new ResizeObserver((entries) => {
      let heightChanged = false;
      for (const entry of entries) {
        const height = entry.contentRect.height;
        if (observedHeights.get(entry.target) !== height) {
          observedHeights.set(entry.target, height);
          heightChanged = true;
        }
      }
      // Horizontal spring motion does not change vertical scroll edges.
      // Content reflow still updates them through its observed height.
      if (heightChanged) update();
    });
    const observe = () => {
      observer.observe(scrollPanel);
      observer.observe(content);
    };
    const activate = (event: Event) => {
      if (event.target !== body) return;
      isOutgoing = false;
      layer.inert = false;
      panel = scrollPanel;
      observe();
      update();
    };
    const deactivate = (event: Event) => {
      if (event.target !== body) return;
      // Preserve this layer's last scroll and edge state throughout its outro.
      update();
      isOutgoing = true;
      observer.disconnect();
      layer.inert = true;
      if (panel === scrollPanel) panel = null;
    };
    observe();
    scrollPanel.addEventListener('scroll', update, { passive: true });
    body.addEventListener('introstart', activate);
    body.addEventListener('outrostart', deactivate);
    update();
    return {
      destroy() {
        observer.disconnect();
        scrollPanel.removeEventListener('scroll', update);
        body.removeEventListener('introstart', activate);
        body.removeEventListener('outrostart', deactivate);
        if (panel === scrollPanel) panel = null;
      },
    };
  };
</script>

<div class="browser-page-stack" class:reduce-blur={reduceBlur}>
  {#each [page] as mountedPage (mountedPage)}
    <div
      class="browser-page-layer"
      class:is-settings={mountedPage === 'settings'}
      data-browser-page={mountedPage}
      use:trackPageLayer={mountedPage}
    >
      <div
        class="browser-page-panel"
        class:is-preset-move-root-target={isDropTarget && mountedPage === page}
      >
        <div class="browser-page-content" class:is-settings={mountedPage === 'settings'}>
          <div
            class="browser-page-body"
            class:is-settings={mountedPage === 'settings'}
            in:libraryFly={mountedPage}
            out:libraryFly={mountedPage}
          >
            <div class="browser-page-fade" in:pageFade out:pageFade>
              {@render children()}
            </div>
          </div>
        </div>
      </div>
    </div>
  {/each}
</div>

<style lang="scss">
  .browser-page-stack {
    --browser-page-top-effect-strength: 0;
    --browser-page-bottom-effect-strength: 0;

    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    margin-top: calc(0px - var(--browser-page-top-inset));
    margin-bottom: calc(0px - var(--browser-page-bottom-extension));

    &::before,
    &::after {
      content: '';
      position: absolute;
      left: calc(0px - var(--gap-4));
      right: calc(0px - var(--gap-4));
      z-index: 2;
      pointer-events: none;
      backdrop-filter: blur(var(--gap-4));
    }

    &::before {
      top: 0;
      height: calc(
        var(--browser-page-top-inset)
        + var(--browser-page-fade-size)
        - var(--browser-page-blur-offset)
      );
      mask-image: linear-gradient(
        to bottom,
        black 0 calc(
          var(--browser-page-top-inset) - var(--browser-page-blur-offset)
        ),
        transparent
      );
      opacity: var(--browser-page-top-effect-strength);
    }

    &::after {
      bottom: 0;
      height: calc(
        var(--browser-page-fade-size) - var(--browser-page-blur-offset)
      );
      mask-image: linear-gradient(
        to top,
        black,
        transparent
      );
      opacity: var(--browser-page-bottom-effect-strength);
    }
  }

  .browser-page-layer {
    --browser-page-top-mask-opacity: 1;
    --browser-page-bottom-mask-opacity: 1;

    position: absolute;
    inset: 0;
  }

  .browser-page-layer:not(.is-settings) {
    z-index: 1;
  }

  .browser-page-panel {
    position: absolute;
    inset: 0;
    padding-top: var(--browser-page-top-inset);
    padding-bottom: var(--browser-page-bottom-extension);
    overflow-y: auto;
    overflow-x: hidden;
    mask-image: linear-gradient(
      to bottom,
      rgb(0 0 0 / var(--browser-page-top-mask-opacity))
        0 var(--browser-page-top-inset),
      black calc(
        var(--browser-page-top-inset) + var(--browser-page-fade-size)
      ),
      black calc(100% - var(--browser-page-fade-size)),
      rgb(0 0 0 / var(--browser-page-bottom-mask-opacity))
    );

    &.is-preset-move-root-target {
      background: var(--color-surface-interactive);
      border-radius: var(--radius-4);
    }
  }

  .browser-page-content {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    width: 100%;
    min-height: 100%;

    &.is-settings {
      justify-items: end;
    }
  }

  .browser-page-fade,
  .browser-page-body {
    grid-area: 1 / 1;
    display: flex;
    flex-direction: column;
    width: 100%;
    min-height: 100%;
  }

  .browser-page-fade {
    flex: 1;
  }

  .browser-page-body.is-settings {
    // Keep settings content at its final width during the sidebar spring.
    width: calc(100% + var(--settings-sidebar-width) - var(--browser-panel-width));
  }

  .browser-page-stack.reduce-blur::before,
  .browser-page-stack.reduce-blur::after {
    backdrop-filter: none;
  }
</style>
