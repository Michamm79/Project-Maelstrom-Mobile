import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Deployed under https://<user>.github.io/Project-Maelstrom-Mobile/, so the CI
// build sets VITE_BASE. Locally it stays at the root.
export default defineConfig({
  root: 'web',
  base: process.env.VITE_BASE ?? '/',
  resolve: {
    alias: { '@content': resolve(__dirname, 'content/generated') },
  },
  server: {
    host: true,
    // The generated content bundle lives above web/, so the dev server has to be
    // allowed to read the repo root.
    fs: { allow: [resolve(__dirname)] },
  },
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    target: 'es2020',
  },
});
