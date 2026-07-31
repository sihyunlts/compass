import { defineConfig } from 'vite';
import { version } from './package.json' with { type: 'json' };

// https://vitejs.dev/config
export default defineConfig(async () => {
  const { svelte } = await import('@sveltejs/vite-plugin-svelte');
  return {
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
    plugins: [
      svelte(),
    ],
  };
});
