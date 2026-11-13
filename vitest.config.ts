import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
      // 'server-only' throws outside a Next.js server bundle; server modules are plain functions in tests.
      'server-only': path.resolve(__dirname, 'tests/support/server-only.ts'),
    },
  },
  test: { include: ['tests/unit/**/*.test.ts'], testTimeout: 20_000 },
});
