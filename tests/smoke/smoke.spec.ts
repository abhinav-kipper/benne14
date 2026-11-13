import { expect, test } from '@playwright/test';

// Smoke checks for a deployed site (a Vercel preview or production). READ-ONLY: nothing here places,
// changes or cancels an order, so it is safe to point at the live shop. Run: SMOKE_URL=https://… npm run smoke

test('health: database reachable, staff PIN set', async ({ request }) => {
  const r = await request.get('/api/health');
  const h = await r.json();
  expect(h, JSON.stringify(h)).toMatchObject({ ok: true, database: 'ok', staffPin: 'set' });
  expect(h.store).toBe('supabase'); // a deploy on the memory store would lose orders between requests
  if (process.env.SMOKE_EXPECT_LIVE === '1') expect(h.testMode).toBe('off'); // production: no free cash orders
});

test('kiosk opens and shows the menu with prices', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 1280 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await expect(page.getByTestId('item-masala-dosa')).toBeVisible();
  await expect(page.getByTestId('item-masala-dosa')).toContainText(/₹\d+/);
  await page.getByTestId('item-masala-dosa').click();
  await expect(page.getByTestId('sheet')).toBeVisible();
  expect(errors).toEqual([]);
});

test('kitchen asks for the staff PIN', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/kitchen');
  await expect(page.getByTestId('pin-gate')).toBeVisible();
});

test('TV board loads and is online', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/board');
  await expect(page.getByText('On the tawa')).toBeVisible();
  await page.waitForTimeout(3000);
  await expect(page.getByText('reconnecting')).toHaveCount(0);
});

test('live orders API answers, and bad input is refused before touching the database', async ({ request }) => {
  const live = await request.get('/api/orders');
  expect(live.status()).toBe(200);
  expect(Array.isArray(await live.json())).toBe(true);
  expect((await request.post('/api/orders', { data: '{bad', headers: { 'Content-Type': 'application/json' } })).status()).toBe(400);
  expect((await request.post('/api/orders', { data: { key: 'x' } })).status()).toBe(400);
  expect((await request.get('/api/orders/not-an-id')).status()).toBe(404);
  expect((await request.post('/api/orders/00000000-0000-0000-0000-000000000000/status', { data: { to: 'new' } })).status()).toBe(401);
});

test('owner dashboard asks for the PIN; menu changes endpoint answers', async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/admin');
  await expect(page.getByTestId('pin-gate')).toBeVisible();
  const m = await request.get('/api/menu');
  expect(m.status()).toBe(200);
  expect(await m.json()).toMatchObject({ items: expect.any(Object), options: expect.any(Object) });
  expect((await request.get('/api/admin/events')).status()).toBe(401);
});

test('a wrong bill link says so', async ({ page }) => {
  await page.goto('/r/00000000-0000-0000-0000-000000000000');
  await expect(page.getByTestId('bill-missing')).toBeVisible({ timeout: 10_000 });
});
