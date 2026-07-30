import { clamp } from '../../../shared/math';

const BADGE_OFFSET_X = 12;
const BADGE_OFFSET_Y = 12;
const BADGE_VIEWPORT_MARGIN_PX = 8;

export interface BrowserDragBadgeContent {
  icon: string;
  iconStyle: string;
  label: string;
}

export const showBrowserDragBadge = (
  badge: HTMLElement,
  content: BrowserDragBadgeContent,
  clientX: number,
  clientY: number,
): void => {
  if (!content.label) {
    return;
  }

  const iconElement = badge.querySelector<HTMLElement>(
    '.browser-drag-badge-icon',
  );
  const labelElement = badge.querySelector<HTMLElement>(
    '.browser-drag-badge-label',
  );
  if (!iconElement || !labelElement) {
    return;
  }
  iconElement.textContent = content.icon;
  iconElement.style.cssText = content.iconStyle;
  labelElement.textContent = content.label;
  badge.hidden = false;
  badge.classList.add('is-visible');

  const maxX = Math.max(
    BADGE_VIEWPORT_MARGIN_PX,
    window.innerWidth - badge.offsetWidth - BADGE_VIEWPORT_MARGIN_PX,
  );
  const maxY = Math.max(
    BADGE_VIEWPORT_MARGIN_PX,
    window.innerHeight - badge.offsetHeight - BADGE_VIEWPORT_MARGIN_PX,
  );
  const x = clamp(
    clientX + BADGE_OFFSET_X,
    BADGE_VIEWPORT_MARGIN_PX,
    maxX,
  );
  const y = clamp(
    clientY + BADGE_OFFSET_Y,
    BADGE_VIEWPORT_MARGIN_PX,
    maxY,
  );
  badge.style.transform = `translate3d(${x}px, ${y}px, 0)`;
};

export const hideBrowserDragBadge = (badge: HTMLElement): void => {
  badge.classList.remove('is-visible');
  badge.hidden = true;
  badge.style.removeProperty('transform');
};
