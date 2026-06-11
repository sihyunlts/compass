import { defineConfig } from 'vite';
import { version } from './package.json';

// https://vitejs.dev/config
export default defineConfig(async () => {
  const { svelte, vitePreprocess } = await import('@sveltejs/vite-plugin-svelte');
  return {
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    plugins: [
      svelte({
        preprocess: vitePreprocess(),
      }),
    ],
  };
});
