import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import sveltePlugin from 'eslint-plugin-svelte';

export default [
  {
    ignores: [
      '**/.vite/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      'tmp/**',
      'max4live/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...sveltePlugin.configs['flat/recommended'],
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.svelte.ts'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.svelte'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
      globals: {
        ...globals.browser,
      },
    },
  },
];
