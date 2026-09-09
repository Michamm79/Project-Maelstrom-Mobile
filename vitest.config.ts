import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

// Separate from vite.config.ts, which sets root: 'web' for the app build.
// Tests run from the repo root so they can reach both web/src and content/.
export default defineConfig({
  resolve: {
    alias: { '@content': resolve(__dirname, 'content/generated') },
  },
  test: {
    environment: 'node',
    include: ['web/src/**/*.test.ts'],
  },
});
