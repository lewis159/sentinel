import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Minimal Vitest config for Sentinel v2 pure-logic unit tests.
// Resolves the `@/*` alias to the repo root so `@/lib/...` imports work, and
// scopes the run to node-environment unit tests only.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
