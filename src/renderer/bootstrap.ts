import { mount } from 'svelte';

import App from './App.svelte';

export const bootstrapMainWindow = (root: HTMLElement): void => {
  mount(App, {
    target: root,
  });
};
