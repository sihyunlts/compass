import './renderer/styles/index.scss';
import { bootstrapMainWindow } from './renderer/bootstrap';
import { bootstrapPreviewWindow } from './renderer/preview-window/bootstrap';

const installTabOnlyFocusMode = (): void => {
  const { body } = document;
  if (!body) {
    return;
  }

  const setTabFocusMode = (enabled: boolean): void => {
    if (enabled) {
      body.setAttribute('data-focus-nav', 'tab');
      return;
    }
    body.removeAttribute('data-focus-nav');
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Tab') {
      setTabFocusMode(true);
    }
  };

  const handlePointerInput = (): void => {
    setTabFocusMode(false);
  };

  setTabFocusMode(false);
  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('pointerdown', handlePointerInput, true);
};

const renderFatal = (message: string): void => {
  const fallback = document.createElement('pre');
  fallback.style.margin = '24px';
  fallback.style.whiteSpace = 'pre-wrap';
  fallback.style.fontFamily = 'Menlo, Monaco, Consolas, monospace';
  fallback.style.color = 'oklch(77% 0.136 21)';
  fallback.textContent = `Renderer bootstrap failed:\n${message}`;
  document.body.innerHTML = '';
  document.body.appendChild(fallback);
};

const isPreviewPopoutRoute = (): boolean =>
  window.location.hash.replace(/^#\/?/, '') === 'preview-popout';

const bootstrapRenderer = (root: HTMLElement): void => {
  if (isPreviewPopoutRoute()) {
    bootstrapPreviewWindow(root);
    return;
  }

  bootstrapMainWindow(root);
};

const installWebFallbackFrame = (root: HTMLElement): void => {
  if (window.compass) {
    return;
  }

  document.body.setAttribute('data-runtime', 'web');
  root.classList.add('is-web-fallback');
};

try {
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('Missing #app root element');
  }

  installTabOnlyFocusMode();
  installWebFallbackFrame(root);
  bootstrapRenderer(root);
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  renderFatal(message);
}
