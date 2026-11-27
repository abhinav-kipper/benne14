import { defineConfig, devices } from '@playwright/test';
import { makeKioskKey } from './lib/kioskkey';

// Runs against a production build on the in-memory store (no Supabase needed).
// Two servers from the same build: the normal flow (test mode off) and test mode on.
const safeEnv = {
  STAFF_PIN: '2468',
  PAYMENTS: 'mock',
  MEMORY_CASH: '1', // tests place orders by cash; the switch itself is tested in admin.spec.ts
  // Blank the Supabase vars so tests never write to the real database, even on a machine that has
  // them set (the specs check /api/health before anything else runs).
  NEXT_PUBLIC_SUPABASE_URL: '',
  SUPABASE_SECRET_KEY: '',
  SUPABASE_SERVICE_ROLE_KEY: '',
};

// Made-up credentials shared by the stand-in Easebuzz and the server that talks to it. Not real keys.
const fakeGateway = { EASEBUZZ_KEY: 'FAKEKEY01', EASEBUZZ_SALT: 'FAKESALT01', FAKE_EASEBUZZ_PORT: '3199' };

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  forbidOnly: !!process.env.CI, // a stray test.only must not silently skip the rest in CI
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }], ['list']] : 'list',
  use: {
    trace: 'retain-on-failure',
    // Every test browser and API call acts as a tablet staff have set up as the kiosk (lib/kioskkey.ts).
    // The tests of the lock itself drop this header.
    extraHTTPHeaders: { 'x-kiosk-key': makeKioskKey(safeEnv.STAFF_PIN, '', 'e2etests0001') },
    // Machines with a preinstalled Chromium (e.g. cloud sessions) can point at it; CI downloads its own.
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'flow', testMatch: 'order-flow.spec.ts', use: { baseURL: 'http://localhost:3100' } },
    { name: 'test-mode', testMatch: 'test-mode.spec.ts', use: { baseURL: 'http://localhost:3101' } },
    // API abuse + network failures: own server so its orders never disturb the flow suite's board checks.
    {
      name: 'robustness',
      testMatch: ['api.spec.ts', 'resilience.spec.ts', 'busy.spec.ts', 'clock.spec.ts'],
      use: { baseURL: 'http://localhost:3102' },
    },
    // Owner dashboard: changes prices and sold-out state, so it gets a server of its own.
    { name: 'admin', testMatch: 'admin.spec.ts', use: { baseURL: 'http://localhost:3103' } },
    // UPI through the payment gateway: a server with PAYMENTS=easebuzz, talking to a stand-in Easebuzz.
    { name: 'gateway', testMatch: 'gateway.spec.ts', use: { baseURL: 'http://localhost:3104' } },
    // The same account's other way of taking UPI (InstaCollect), against the same stand-in Easebuzz.
    { name: 'instacollect', testMatch: 'instacollect.spec.ts', use: { baseURL: 'http://localhost:3108' } },
    // One whole day, checked from every screen: a server to itself, so the day's totals are exactly its own.
    { name: 'day', testMatch: 'shop-day.spec.ts', use: { baseURL: 'http://localhost:3105' } },
    // A lunch rush and a long shift: hundreds of orders, so again a server of its own.
    { name: 'load', testMatch: 'rush.spec.ts', use: { baseURL: 'http://localhost:3106' } },
    // The owner app and the customer's bill as phones see them. An iPhone's browsers (Chrome included)
    // all run on Safari's engine, WebKit, so that is the second run. A machine pointed at its own
    // preinstalled Chromium (PW_CHROMIUM) has no WebKit and runs the Android half only; CI runs both.
    {
      name: 'android',
      testMatch: 'phones.spec.ts',
      use: { ...devices['Pixel 7'], baseURL: 'http://localhost:3107' },
    },
    ...(process.env.PW_CHROMIUM
      ? []
      : [
          {
            name: 'iphone',
            testMatch: 'phones.spec.ts',
            use: { ...devices['iPhone 14'], baseURL: 'http://localhost:3107', launchOptions: {} },
          },
        ]),
  ],
  // Servers start in order, so the second reuses the first one's build. reuseExistingServer: false keeps
  // every run on a fresh in-memory store, so leftover orders never leak between runs.
  webServer: [
    {
      command: 'npm run build && npx next start -p 3100',
      url: 'http://localhost:3100',
      timeout: 240_000,
      reuseExistingServer: false,
      env: { ...safeEnv, TEST_MODE: '0' },
    },
    {
      command: 'npx next start -p 3101',
      url: 'http://localhost:3101',
      timeout: 60_000,
      reuseExistingServer: false,
      env: { ...safeEnv, TEST_MODE: '1' },
    },
    {
      command: 'npx next start -p 3103',
      url: 'http://localhost:3103',
      timeout: 60_000,
      reuseExistingServer: false,
      // the owner's server has an owner PIN of its own; the others fall back to the staff PIN
      env: { ...safeEnv, TEST_MODE: '0', OWNER_PIN: '246810' },
    },
    {
      command: 'node tests/support/fake-easebuzz.mjs',
      url: 'http://localhost:3199/__txns',
      timeout: 30_000,
      reuseExistingServer: false,
      env: fakeGateway,
    },
    {
      command: 'npx next start -p 3104',
      url: 'http://localhost:3104',
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...safeEnv,
        ...fakeGateway,
        TEST_MODE: '0',
        PAYMENTS: 'easebuzz',
        EASEBUZZ_PAY_URL: 'http://localhost:3199',
        EASEBUZZ_DASH_URL: 'http://localhost:3199',
      },
    },
    {
      command: 'npx next start -p 3105',
      url: 'http://localhost:3105',
      timeout: 60_000,
      reuseExistingServer: false,
      env: { ...safeEnv, TEST_MODE: '0', OWNER_PIN: '246810' },
    },
    {
      command: 'npx next start -p 3106',
      url: 'http://localhost:3106',
      timeout: 60_000,
      reuseExistingServer: false,
      env: { ...safeEnv, TEST_MODE: '0' },
    },
    {
      command: 'npx next start -p 3107',
      url: 'http://localhost:3107',
      timeout: 60_000,
      reuseExistingServer: false,
      env: { ...safeEnv, TEST_MODE: '0', OWNER_PIN: '246810' },
    },
    {
      command: 'npx next start -p 3108',
      url: 'http://localhost:3108',
      timeout: 60_000,
      reuseExistingServer: false,
      env: {
        ...safeEnv,
        ...fakeGateway,
        TEST_MODE: '0',
        PAYMENTS: 'instacollect',
        EASEBUZZ_WIRE_URL: 'http://localhost:3199',
      },
    },
    {
      command: 'npx next start -p 3102',
      url: 'http://localhost:3102',
      timeout: 60_000,
      reuseExistingServer: false,
      env: { ...safeEnv, TEST_MODE: '0' },
    },
  ],
});
