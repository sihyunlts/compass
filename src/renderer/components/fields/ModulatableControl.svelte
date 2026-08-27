<svelte:options runes={true} />

<script lang="ts">
  import { onMount, tick, type Snippet } from 'svelte';
  import type { RendererControlChange } from '../../../devices/control-types';
  import {
    formatNumericParameterDisplay,
    type NumericParameterDisplay,
  } from '../../../devices/numeric-parameters';
  import type { ModulationParameterState } from '../../../shared/contracts/preview/modulation';
  import { i18n } from '../../i18n.svelte';
  import { activateModulationDisplayTarget } from '../../features/preview/modulation-display-selection.svelte';
  import { hint } from '../overlays/hint';
  import { resolveAnchoredFloatingLayerPosition } from '../overlays/floating-layer';
  import {
    activateFloatingLayer,
    createFloatingLayerId,
    deactivateFloatingLayer,
    resolveFloatingLayerParentId,
  } from '../overlays/floating-layer-stack';
  import {
    resolveModulationAmountRatio,
    type ModulationDisplayDomain,
  } from './modulation-display-domain';

  let {
    states,
    parameterKey,
    modulationContextDeviceId,
    modulationContextParamKey,
    domain,
    cornerScale = 1,
    step = 0.1,
    display,
    dragPixelsPerStep,
    amountPanelGapPx = 4,
    amountHintGapPx = 8,
    children,
    class: className = '',
    onControlChange,
  } = $props<{
    states: readonly ModulationParameterState[];
    parameterKey: string;
    modulationContextDeviceId: string;
    modulationContextParamKey: string;
    domain: ModulationDisplayDomain;
    cornerScale?: number;
    step?: number | string;
    display?: NumericParameterDisplay;
    dragPixelsPerStep?: number;
    amountPanelGapPx?: number;
    amountHintGapPx?: number;
    children?: Snippet;
    class?: string;
    onControlChange: (change: RendererControlChange) => void;
  }>();

  const finiteStates = $derived(states.filter((state: ModulationParameterState) => (
    Number.isFinite(state.amount)
  )));
  const rootClass = $derived(`modulatable-control ${className}`.trim());
  const resolvedCornerScale = $derived(Math.max(0, Math.min(cornerScale, 1)));
  const resolvedAmountPanelGapPx = $derived(Math.max(0, amountPanelGapPx));
  const resolvedAmountHintGapPx = $derived(Math.max(0, amountHintGapPx));
  let controlEl = $state<HTMLDivElement | null>(null);
  let amountListEl = $state<HTMLDivElement | null>(null);
  let pointerInside = $state(false);
  let focusInside = $state(false);
  let dismissAmountListImmediately = $state(false);
  let isAmountListPositioned = $state(false);
  let amountListX = $state(0);
  let amountListY = $state(0);
  let amountListVerticalPlacement = $state<'above' | 'below'>('below');
  let floatingLayerStackOrder = $state(1);
  let positionToken = 0;
  const floatingLayerId = createFloatingLayerId('modulation-amount');
  let hasOpenDescendant = $state(false);
  const isAmountListOpen = $derived(
    finiteStates.length > 0 && (pointerInside || focusInside || hasOpenDescendant),
  );
  const amountHint = (state: ModulationParameterState): string =>
    i18n.t('modulation.amountFor', {
      modulator: state.modulatorLabel,
      amount: display
        ? formatNumericParameterDisplay(display, state.amount, String(state.amount))
        : state.amount,
    });
  const resolveFloatingAnchor = (): HTMLElement | null =>
    controlEl?.querySelector<HTMLElement>('[data-modulation-floating-anchor]')
    ?? controlEl;

  const emitAmountChange = (
    event: Event,
    state: ModulationParameterState,
    finalize: boolean,
  ): void => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    onControlChange({
      action: 'set-modulation-target-amount',
      deviceId: state.modulatorId,
      paramKey: state.targetId,
      value: input.value,
      finalize,
      step: Number(input.step),
    });
  };

  const updateAmountListPosition = async (): Promise<void> => {
    const token = ++positionToken;
    await tick();
    if (
      token !== positionToken
      || !isAmountListOpen
      || !controlEl
      || !amountListEl
    ) {
      return;
    }

    const floatingAnchor = resolveFloatingAnchor();
    if (!floatingAnchor) {
      return;
    }

    const nextPosition = resolveAnchoredFloatingLayerPosition(
      floatingAnchor.getBoundingClientRect(),
      {
        width: amountListEl.offsetWidth,
        height: amountListEl.offsetHeight,
      },
      {
        gapPx: 0,
        horizontalAlignment: 'center',
      },
    );
    amountListX = nextPosition.x;
    amountListY = nextPosition.y;
    amountListVerticalPlacement = nextPosition.verticalPlacement;
    isAmountListPositioned = true;
  };

  const handleFocusOut = (event: FocusEvent): void => {
    const nextTarget = event.relatedTarget;
    focusInside = document.body.dataset.focusNav === 'tab'
      && nextTarget instanceof HTMLElement
      && nextTarget.matches(':focus-visible')
      && controlEl?.contains(nextTarget) === true;
  };

  const handlePointerEnter = (): void => {
    dismissAmountListImmediately = false;
    pointerInside = true;
  };

  const handlePointerDown = (): void => {
    focusInside = false;
  };

  const handlePointerLeave = (event: PointerEvent): void => {
    const nextTarget = event.relatedTarget;
    pointerInside = nextTarget instanceof Node && (
      controlEl?.contains(nextTarget) === true
      || amountListEl?.contains(nextTarget) === true
    );
  };

  const handleDocumentContextMenu = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Node) || controlEl?.contains(target) !== true) {
      return;
    }
    if (amountListEl?.contains(target) === true) {
      return;
    }
    dismissAmountListImmediately = true;
    pointerInside = false;
    focusInside = false;
  };

  const handleFocusIn = (event: FocusEvent): void => {
    const target = event.target;
    focusInside = document.body.dataset.focusNav === 'tab'
      && target instanceof HTMLElement
      && target.matches(':focus-visible');
  };

  $effect(() => {
    if (!isAmountListOpen) {
      positionToken += 1;
      isAmountListPositioned = false;
      return;
    }

    void updateAmountListPosition();
  });

  $effect(() => {
    if (!isAmountListOpen) {
      deactivateFloatingLayer(floatingLayerId);
      return;
    }

    activateFloatingLayer({
      id: floatingLayerId,
      parentId: resolveFloatingLayerParentId(controlEl, floatingLayerId),
      containsEventTarget: (eventTarget) => eventTarget instanceof Node && (
        controlEl?.contains(eventTarget) === true
        || amountListEl?.contains(eventTarget) === true
      ),
      onDismissRequest: () => {
        pointerInside = false;
        focusInside = false;
      },
      onDescendantStateChange: (hasActiveDescendant) => {
        hasOpenDescendant = hasActiveDescendant;
      },
      onStackOrderChange: (stackOrder) => {
        floatingLayerStackOrder = stackOrder;
      },
    });

    return () => deactivateFloatingLayer(floatingLayerId);
  });

  $effect(() => {
    const element = amountListEl;
    if (!element) {
      return;
    }

    element.addEventListener('pointerenter', handlePointerEnter);
    element.addEventListener('pointerleave', handlePointerLeave);
    return () => {
      element.removeEventListener('pointerenter', handlePointerEnter);
      element.removeEventListener('pointerleave', handlePointerLeave);
    };
  });

  onMount(() => {
    const updateOpenAmountListPosition = (): void => {
      if (isAmountListOpen) {
        void updateAmountListPosition();
      }
    };
    const resizeObserver = new ResizeObserver(updateOpenAmountListPosition);
    if (controlEl) {
      resizeObserver.observe(controlEl);
      controlEl.addEventListener('pointerenter', handlePointerEnter);
      controlEl.addEventListener('pointerleave', handlePointerLeave);
      controlEl.addEventListener('pointerdown', handlePointerDown);
      controlEl.addEventListener('focusin', handleFocusIn);
      controlEl.addEventListener('focusout', handleFocusOut);
    }

    window.addEventListener('scroll', updateOpenAmountListPosition, {
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', updateOpenAmountListPosition);
    document.addEventListener('contextmenu', handleDocumentContextMenu, true);
    return () => {
      resizeObserver.disconnect();
      controlEl?.removeEventListener('pointerenter', handlePointerEnter);
      controlEl?.removeEventListener('pointerleave', handlePointerLeave);
      controlEl?.removeEventListener('pointerdown', handlePointerDown);
      controlEl?.removeEventListener('focusin', handleFocusIn);
      controlEl?.removeEventListener('focusout', handleFocusOut);
      window.removeEventListener('scroll', updateOpenAmountListPosition, true);
      window.removeEventListener('resize', updateOpenAmountListPosition);
      document.removeEventListener('contextmenu', handleDocumentContextMenu, true);
    };
  });
</script>

<div
  bind:this={controlEl}
  class={rootClass}
  style={`--modulation-control-corner-scale:${resolvedCornerScale};`}
>
  {#if children}
    {@render children()}
  {/if}
  {#if finiteStates.length > 0}
    <div
      bind:this={amountListEl}
      class="modulation-amount-hover-region"
      class:is-open={isAmountListOpen && isAmountListPositioned}
      class:opens-above={amountListVerticalPlacement === 'above'}
      class:dismiss-immediately={dismissAmountListImmediately}
      data-modulation-context-device-id={modulationContextDeviceId}
      data-modulation-context-param={modulationContextParamKey}
      aria-hidden={!isAmountListOpen || !isAmountListPositioned}
      style:transform={`translate3d(${amountListX}px, ${amountListY}px, 0)`}
      style:--modulation-amount-panel-gap={`${resolvedAmountPanelGapPx}px`}
      style:--floating-layer-stack-order={floatingLayerStackOrder}
    >
      <div class="modulation-amount-list">
        {#each finiteStates as state (`${state.modulatorId}:${state.targetId}`)}
          {@const amountRatio = resolveModulationAmountRatio(state.amount, domain)}
          {@const amountArcLength = amountRatio * 37.5}
          <div class="modulation-amount-control">
            <svg
              class="modulation-amount-ring"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle
                class="modulation-amount-ring-track"
                cx="12"
                cy="12"
                r="9"
                pathLength="100"
                stroke-dasharray="75 25"
                transform="rotate(135 12 12)"
              ></circle>
              <circle
                class="modulation-amount-ring-value"
                cx="12"
                cy="12"
                r="9"
                pathLength="100"
                stroke-dasharray={`${amountArcLength} ${100 - amountArcLength}`}
                stroke-dashoffset={state.amount < 0 ? amountArcLength : 0}
                transform="rotate(-90 12 12)"
              ></circle>
            </svg>
            <input
              class="modulation-amount-input"
              type="number"
              step={step}
              data-drag-pixels-per-step={dragPixelsPerStep}
              value={state.amount}
              aria-label={amountHint(state)}
              use:hint={{
                text: amountHint(state),
                placement: amountListVerticalPlacement,
                delayMs: 0,
                gapPx: resolvedAmountHintGapPx,
                dismissOnPointerDown: false,
              }}
              data-control-action="set-modulation-target-amount"
              data-device-id={state.modulatorId}
              data-param={state.targetId}
              onpointerdown={() => activateModulationDisplayTarget(parameterKey, state)}
              oninput={(event) => emitAmountChange(event, state, false)}
              onchange={(event) => emitAmountChange(event, state, true)}
            />
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style lang="scss">
  .modulatable-control {
    --modulation-control-accent: var(
      --device-control-accent,
      var(--color-category-utility)
    );

    position: relative;
    min-width: 0;
    min-height: 0;
  }

  .modulation-amount-hover-region {
    position: fixed;
    z-index: calc(
      var(--z-layer-floating-stack-base)
      + var(--floating-layer-stack-order, 0)
    );
    inset: 0 auto auto 0;
    max-width: calc(100vw - var(--gap-16));
    padding-top: var(--modulation-amount-panel-gap);
    visibility: hidden;
    opacity: 0;
    pointer-events: none;
    transition: opacity 120ms ease, visibility 120ms step-end;

    &.opens-above {
      padding-top: 0;
      padding-bottom: var(--modulation-amount-panel-gap);
    }

    &.is-open {
      visibility: visible;
      opacity: 1;
      pointer-events: auto;
      transition: opacity 120ms ease;
    }

    &.dismiss-immediately {
      visibility: hidden;
      opacity: 0;
      pointer-events: none;
      transition: none;
    }
  }

  .modulation-amount-list {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    max-width: 100%;
    padding: var(--gap-4);
    overflow-x: auto;
    border: 1px solid var(--color-border-floating);
    border-radius: var(--radius-8);
    background: var(--color-surface-floating);
    backdrop-filter: blur(8px);
    box-shadow: var(--shadow-floating);
  }

  .modulation-amount-control {
    position: relative;
    display: block;
    width: var(--gap-20);
    height: var(--gap-20);
    flex: 0 0 var(--gap-20);
    border-radius: var(--radius-round);
  }

  .modulation-amount-ring {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
  }

  .modulation-amount-ring-track,
  .modulation-amount-ring-value {
    fill: none;
    stroke-width: 3;
    stroke-linecap: round;
  }

  .modulation-amount-ring-track {
    stroke: var(--color-border-secondary);
  }

  .modulation-amount-ring-value {
    stroke: var(--modulation-control-accent);
  }

  .modulation-amount-input {
    appearance: none;
    position: absolute;
    z-index: 1;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: transparent;
    caret-color: transparent;
    cursor: n-resize;
    opacity: 0;
  }
</style>
