import { defineConfig, type Plugin } from 'vite';

const forgePreloadOutputCompatibility = (): Plugin => ({
  name: 'forge-preload-output-compatibility',
  config(config) {
    const output = config.build?.rollupOptions?.output;
    if (output && !Array.isArray(output)) {
      delete output.inlineDynamicImports;
    }

    return {
      build: {
        rolldownOptions: {
          output: {
            codeSplitting: false,
          },
        },
      },
    };
  },
});

// https://vitejs.dev/config
export default defineConfig({
  plugins: [forgePreloadOutputCompatibility()],
});
