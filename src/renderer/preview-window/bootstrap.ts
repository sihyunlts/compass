import { mount } from 'svelte';

import App from './App.svelte';

export const bootstrapPreviewWindow = (root: HTMLElement): void => {
  root.classList.add('is-preview-popout');
  mount(App, {
    target: root,
  });
};
