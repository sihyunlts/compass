let hintIdCounter = 0;

type HintValue = string | null | undefined;

type HintAction = {
  update: (nextValue: HintValue) => void;
  destroy: () => void;
};

const HINT_DELAY_MS = 360;
const VIEWPORT_PADDING_PX = 8;
const HINT_GAP_PX = 6;

const normalizeHint = (value: HintValue): string =>
  typeof value === 'string' ? value.trim() : '';

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const hint = (node: HTMLElement, value: HintValue): HintAction => {
  let hintText = normalizeHint(value);
  let hintEl: HTMLDivElement | null = null;
  let showTimer: number | null = null;
  let previousDescribedBy: string | null = null;
  let didFocusFromPointer = false;
  const hintId = `app-hint-${++hintIdCounter}`;

  const clearShowTimer = (): void => {
    if (showTimer === null) {
      return;
    }

    window.clearTimeout(showTimer);
    showTimer = null;
  };

  const positionHint = (): void => {
    if (!hintEl) {
      return;
    }

    const anchorRect = node.getBoundingClientRect();
    const hintRect = hintEl.getBoundingClientRect();
    const maxX = Math.max(VIEWPORT_PADDING_PX, window.innerWidth - hintRect.width - VIEWPORT_PADDING_PX);
    const x = clamp(
      anchorRect.left + (anchorRect.width - hintRect.width) / 2,
      VIEWPORT_PADDING_PX,
      maxX,
    );
    const belowY = anchorRect.bottom + HINT_GAP_PX;
    const aboveY = anchorRect.top - hintRect.height - HINT_GAP_PX;
    const y = belowY + hintRect.height <= window.innerHeight - VIEWPORT_PADDING_PX
      ? belowY
      : Math.max(VIEWPORT_PADDING_PX, aboveY);

    hintEl.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
  };

  const closeHint = (): void => {
    clearShowTimer();
    const wasOpen = hintEl !== null;
    hintEl?.remove();
    hintEl = null;

    if (wasOpen) {
      if (previousDescribedBy === null) {
        node.removeAttribute('aria-describedby');
      } else {
        node.setAttribute('aria-describedby', previousDescribedBy);
      }
      previousDescribedBy = null;
    }

    window.removeEventListener('scroll', closeHint, true);
    window.removeEventListener('resize', closeHint);
    document.removeEventListener('pointerdown', closeHint, true);
    document.removeEventListener('keydown', handleDocumentKeyDown, true);
  };

  const openHint = (): void => {
    clearShowTimer();
    if (!hintText || node.matches(':disabled')) {
      return;
    }

    if (!hintEl) {
      previousDescribedBy = node.getAttribute('aria-describedby');
      node.setAttribute(
        'aria-describedby',
        previousDescribedBy ? `${previousDescribedBy} ${hintId}` : hintId,
      );

      hintEl = document.createElement('div');
      hintEl.id = hintId;
      hintEl.className = 'app-hint';
      hintEl.role = 'tooltip';
      document.body.append(hintEl);

      window.addEventListener('scroll', closeHint, true);
      window.addEventListener('resize', closeHint);
      document.addEventListener('pointerdown', closeHint, true);
      document.addEventListener('keydown', handleDocumentKeyDown, true);
    }

    hintEl.textContent = hintText;
    positionHint();
  };

  function handleDocumentKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      closeHint();
    }
  }

  const scheduleHint = (delayMs: number): void => {
    clearShowTimer();
    if (!hintText || node.matches(':disabled')) {
      return;
    }

    showTimer = window.setTimeout(openHint, delayMs);
  };

  const handlePointerEnter = (): void => scheduleHint(HINT_DELAY_MS);
  const handlePointerDown = (): void => {
    didFocusFromPointer = true;
    closeHint();
    window.setTimeout(() => {
      didFocusFromPointer = false;
    }, 0);
  };
  const handleFocus = (): void => {
    if (!didFocusFromPointer) {
      scheduleHint(0);
    }
  };

  node.addEventListener('pointerenter', handlePointerEnter);
  node.addEventListener('pointerdown', handlePointerDown);
  node.addEventListener('pointerleave', closeHint);
  node.addEventListener('focus', handleFocus);
  node.addEventListener('blur', closeHint);

  return {
    update(nextValue: HintValue): void {
      hintText = normalizeHint(nextValue);
      if (!hintText) {
        closeHint();
        return;
      }

      if (hintEl) {
        hintEl.textContent = hintText;
        positionHint();
      }
    },
    destroy(): void {
      node.removeEventListener('pointerenter', handlePointerEnter);
      node.removeEventListener('pointerdown', handlePointerDown);
      node.removeEventListener('pointerleave', closeHint);
      node.removeEventListener('focus', handleFocus);
      node.removeEventListener('blur', closeHint);
      closeHint();
    },
  };
};
