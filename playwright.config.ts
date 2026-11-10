import { defineConfig } from '@playwright/test';

// Runs against a production build on the in-memory store (no Supabase needed).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'retain-on-failure',
    // Machines with a preinstalled Chromium (e.g. cloud sessions) can point at it; CI downloads its own.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  webServer: {
    command: 'npm run build && npx next start -p 3100',
    url: 'http://localhost:3100',
    timeout: 240_000,
    reuseExistingServer: false, // always a fresh in-memory store, so leftover orders never leak between runs
    // Blank the Supabase vars so tests never write to the real database, even on a machine that has
    // them set (tests/e2e/order-flow.spec.ts checks this before anything else runs).
    env: { STAFF_PIN: '2468', NEXT_PUBLIC_SUPABASE_URL: '', SUPABASE_SECRET_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' },
  },
});
