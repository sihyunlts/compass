import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig(async () => {
  const { svelte, vitePreprocess } = await import('@sveltejs/vite-plugin-svelte');
  return {
    plugins: [
      svelte({
        preprocess: vitePreprocess(),
      }),
    ],
  };
});
