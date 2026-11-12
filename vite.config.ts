import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages project sites are served from /<repository-name>/.
  // Set BASE_PATH in CI; local development defaults to the domain root.
  base: process.env.BASE_PATH || '/',
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
    clearMocks: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
