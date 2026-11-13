import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Database integration tests (tests/integration): need DB_TEST_URL, see .github/workflows/ci.yml.
export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname), 'server-only': path.resolve(__dirname, 'tests/support/server-only.ts') },
  },
  test: { include: ['tests/integration/**/*.test.ts'], testTimeout: 30_000, fileParallelism: false },
});
