import 'interlude-ui/css/dynamic-subset';
import './renderer/styles/index.scss';
import { bootstrapMainWindow } from './renderer/bootstrap';
import { bootstrapPreviewWindow } from './renderer/preview-window/bootstrap';
import { initializeTheme } from './renderer/app/theme';

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

  const clearTabFocusMode = (): void => {
    setTabFocusMode(false);
  };

  setTabFocusMode(false);
  window.addEventListener('keydown', handleKeyDown, true);
  window.addEventListener('pointerdown', clearTabFocusMode, true);
  window.addEventListener('blur', clearTabFocusMode);
};

const renderFatal = (message: string): void => {
  const fallback = document.createElement('pre');
  fallback.style.margin = '24px';
  fallback.style.whiteSpace = 'pre-wrap';
  fallback.style.fontFamily = 'Menlo, Monaco, Consolas, monospace';
  fallback.style.color = 'var(--color-error)';
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

const installPageFrame = (root: HTMLElement): void => {
  if (window.compass?.runtime === 'electron') {
    return;
  }

  document.body.setAttribute('data-frame', 'in-page');
  root.classList.add('has-in-page-frame');
};

try {
  const root = document.getElementById('app');
  if (!root) {
    throw new Error('Missing #app root element');
  }

  installTabOnlyFocusMode();
  installPageFrame(root);
  initializeTheme();
  bootstrapRenderer(root);
} catch (error) {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  renderFatal(message);
}
