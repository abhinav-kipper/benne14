import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

// Things that happen because time passes, with the browser's clock wound forward: the 4 am
// restart of every shop screen, and a chit turning amber and red as an order waits. (What the
// server does at midnight is in tests/unit/midnight.test.ts: its clock can't be wound from here.)
const PIN = '2468';

test.beforeAll(async ({ request }) => {
  const h = await (await request.get('/api/health')).json();
  if (h.store !== 'memory') throw new Error(`Refusing to run e2e against the ${h.store} store`);
});

const staff = async (page: Page) => page.addInitScript((pin) => localStorage.setItem('benne14.staffPin', pin), PIN);
const paidOrder = async (r: APIRequestContext) => {
  const o = await (
    await r.post('/api/orders', {
      data: {
        key: `clock-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        type: 'takeaway',
        name: null,
        payMethod: 'cash',
        lines: [{ itemId: 'masala-tea', qty: 1, choices: {}, notes: [] }],
      },
    })
  ).json();
  await r.post(`/api/orders/${o.id}/status`, { data: { to: 'new' }, headers: { 'x-staff-pin': PIN } });
  return o;
};
// 3:58 in the morning, by the screen's own clock
const BEFORE_FOUR = new Date(2026, 10, 17, 3, 58, 0);

for (const [name, path, size] of [
  ['kitchen', '/kitchen', { width: 1280, height: 800 }],
  ['TV board', '/board', { width: 1920, height: 1080 }],
] as const)
  test(`${name}: restarts itself once in the small hours, and only once`, async ({ page }) => {
    let loads = 0;
    page.on('load', () => loads++);
    await staff(page);
    await page.clock.install({ time: BEFORE_FOUR });
    await page.setViewportSize(size);
    await page.goto(path);
    expect(loads).toBe(1);
    await page.clock.runFor(90_000); // 3:59: not yet
    expect(loads).toBe(1);
    await page.clock.runFor(2 * 60_000); // just past four
    await expect.poll(() => loads, { timeout: 15_000 }).toBe(2);
    await page.clock.runFor(40 * 60_000); // the rest of that hour: it does not keep restarting
    await page.waitForTimeout(500);
    expect(loads).toBe(2);
  });

test('kiosk: a 4 am customer finishes their order before the kiosk restarts', async ({ page }) => {
  let loads = 0;
  page.on('load', () => loads++);
  await page.clock.install({ time: BEFORE_FOUR });
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.goto('/kiosk');
  await page.getByTestId('start').click();
  await page.getByTestId('item-masala-tea').click();
  await page.getByTestId('add-to-order').click(); // mid-order as four o'clock comes
  await page.clock.runFor(30_000);
  await page.getByTestId('cartbar').click(); // still busy with it
  await page.clock.runFor(30_000);
  await page.mouse.click(400, 300);
  await page.clock.runFor(30_000);
  await page.mouse.click(400, 300);
  await page.clock.runFor(45_000); // it is past four now
  expect(loads).toBe(1); // the order was not thrown away
  // the customer walks off: "Still there?", back to the start screen, and then the restart
  await page.clock.runFor(121_000);
  await page.clock.runFor(16_000);
  await page.clock.runFor(61_000);
  await expect.poll(() => loads, { timeout: 15_000 }).toBe(2);
  await expect(page.getByTestId('start')).toBeVisible();
});

test('kitchen: a chit goes amber after 8 minutes and red after 12, by the clock alone', async ({ page, request }) => {
  const o = await paidOrder(request);
  await staff(page);
  await page.clock.install();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/kitchen');
  const chit = page.getByTestId(`chit-${o.token}`);
  await expect(chit).toBeVisible();
  await expect(chit).not.toHaveClass(/warn|late/);
  await page.clock.runFor(8 * 60_000 + 20_000);
  await expect(chit).toHaveClass(/warn/);
  await expect(chit).toContainText(/8\s*min/);
  await page.clock.runFor(4 * 60_000);
  await expect(chit).toHaveClass(/late/);
  await expect(chit).toContainText(/12\s*min/);
  await request.post(`/api/orders/${o.id}/status`, { data: { to: 'cancelled' }, headers: { 'x-staff-pin': PIN } });
});
