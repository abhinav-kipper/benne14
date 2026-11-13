import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Rush hour and long-running screens: every ready order visible on the TV, a full kitchen rail says
// how many orders are out of view, new orders flash, sound is remembered, screens reload after a deploy.
const PIN = '2468';
const H = { 'x-staff-pin': PIN };
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  if (h.store !== 'memory') throw new Error(`Refusing to run e2e against the ${h.store} store`);
});

let k = 0;
const paidOrder = async (r: APIRequestContext, upTo: 'new' | 'ready') => {
  const o = await (await r.post('/api/orders', { data: { key: `busy-${Date.now()}-${k++}`, type: 'takeaway', name: null, payMethod: 'cash', lines: [{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }] } })).json();
  for (const to of upTo === 'new' ? ['new'] : ['new', 'cooking', 'ready']) await r.post(`/api/orders/${o.id}/status`, { data: { to }, headers: H });
  return o as { id: string; token: string };
};
const finish = async (r: APIRequestContext, orders: { id: string }[]) => {
  for (const o of orders) for (const to of ['cooking', 'ready', 'handed_over']) await r.post(`/api/orders/${o.id}/status`, { data: { to }, headers: H });
};
const kitchen = async (page: Page) => {
  await page.addInitScript((pin) => localStorage.setItem('benne14.staffPin', pin), PIN);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/kitchen');
};

test('TV board shows every ready order, however many', async ({ page, request }) => {
  const orders = [];
  for (let i = 0; i < 9; i++) orders.push(await paidOrder(request, 'ready'));
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/board');
  await expect(page.getByTestId('board-hero')).toBeVisible({ timeout: 5000 });
  expect(Number(await page.getByTestId('board-ready').getAttribute('data-tier'))).toBeGreaterThanOrEqual(2);
  const hero = (await page.getByTestId('board-hero').locator('.num').textContent())!;
  for (const o of orders) {
    if (o.token === hero) continue;
    await expect(page.getByTestId(`board-ready-${o.token}`)).toBeInViewport();
  }
  // nothing spills out of the ready column
  expect(await page.getByTestId('board-ready').evaluate((el) => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  await finish(request, orders);
});

test('a full kitchen rail says how many orders are out of view, and a new order flashes', async ({ page, request }) => {
  const orders = [];
  for (let i = 0; i < 8; i++) orders.push(await paidOrder(request, 'new'));
  await kitchen(page);
  await expect(page.getByTestId(`chit-${orders[0].token}`)).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.chits.narrow')).toBeVisible(); // narrower chits once it's busy
  const more = page.getByTestId('rail-more');
  await expect(more).toBeVisible();
  expect(Number((await more.locator('b').textContent())!.replace('+', ''))).toBeGreaterThanOrEqual(3);
  await more.click();
  await expect(page.getByTestId('rail-earlier')).toBeVisible();
  const late = await paidOrder(request, 'new');
  await expect(page.locator('.kitchen .flash')).toBeVisible({ timeout: 5000 });
  await finish(request, [...orders, late]);
  await expect(page.getByTestId('rail-more')).toHaveCount(0, { timeout: 8000 });
});

test('kitchen remembers that sound was on and asks for one tap after a reload', async ({ page }) => {
  await kitchen(page);
  await expect(page.getByTestId('soundbar')).toHaveCount(0);
  await page.getByTestId('sound').click();
  await expect(page.getByTestId('sound')).toContainText('Sound on');
  await page.reload();
  await expect(page.getByTestId('soundbar')).toBeVisible();
  await page.locator('.kitchen .top .logo').click(); // a tap anywhere
  await expect(page.getByTestId('soundbar')).toHaveCount(0);
  await expect(page.getByTestId('sound')).toContainText('Sound on');
});

test('kitchen reloads itself when a new version is deployed', async ({ page }) => {
  let loads = 0;
  page.on('load', () => loads++);
  await page.route('**/api/version', (r) => r.fulfill({ json: { build: 'a-newer-build' } }), { times: 1 });
  await kitchen(page);
  await expect.poll(() => loads, { timeout: 15_000 }).toBe(2); // loaded, noticed the new build, reloaded once
  await expect(page.getByText('Ready at counter')).toBeVisible();
  // If the server keeps reporting that same build (a misconfigured id), the screen must not loop.
  await page.route('**/api/version', (r) => r.fulfill({ json: { build: 'a-newer-build' } }));
  await page.reload();
  await page.waitForTimeout(8000);
  expect(loads).toBe(3); // only the reload this test did itself
});

test('kiosk waits for the start screen before reloading for a new version', async ({ page }) => {
  let loads = 0;
  page.on('load', () => loads++);
  await page.clock.install();
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-masala-tea').click();
  await page.getByTestId('add-to-order').click(); // a customer is mid-order
  await page.route('**/api/version', (r) => r.fulfill({ json: { build: 'a-newer-build' } }));
  await page.clock.runFor(61_000); // the version check runs and sees the new build
  await expect(page.getByTestId('cartbar')).toBeVisible();
  expect(loads).toBe(1); // …but the order is not interrupted
  await page.unroute('**/api/version');
  await page.clock.runFor(35_000); // customer walks away → "Still there?" → back to the start screen
  await page.clock.runFor(16_000);
  await page.clock.runFor(6_000);
  await expect.poll(() => loads, { timeout: 15_000 }).toBe(2);
});
