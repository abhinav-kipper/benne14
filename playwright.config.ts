import { defineConfig } from '@playwright/test';

// Runs against a production build on the in-memory store (no Supabase needed).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run build && npx next start -p 3100',
    url: 'http://localhost:3100',
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { STAFF_PIN: '2468' },
  },
});
