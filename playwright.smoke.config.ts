import { defineConfig } from '@playwright/test';

// Read-only smoke checks against a deployed URL (see tests/smoke). No local server.
const url = process.env.SMOKE_URL;
if (!url) throw new Error('Set SMOKE_URL to the deployment to check, e.g. SMOKE_URL=https://benne14.vercel.app');

export default defineConfig({
  testDir: 'tests/smoke',
  timeout: 45_000,
  retries: 1, // a cold serverless start or a waking free-tier database can time out once
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: url,
    trace: 'retain-on-failure',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
});
